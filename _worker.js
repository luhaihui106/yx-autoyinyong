// Cloudflare Worker - 简化版优选工具
// 仅保留优选域名、优选IP、GitHub、上报和节点生成功能
// 修复记录：已修正 VMess 协议下节点名称包含中文导致 Error 1101 的问题

// 默认配置
let customPreferredIPs = [];
let customPreferredDomains = [];
let epd = true;  // 启用优选域名
let epi = true;  // 启用优选IP
let egi = true;  // 启用GitHub优选
let ev = true;   // 启用VLESS协议
let et = false;  // 启用Trojan协议
let vm = false;  // 启用VMess协议
let scu = 'https://url.v1.mk/sub';  // 订阅转换地址
// ECH (Encrypted Client Hello)
let enableECH = false;
let customDNS = 'https://dns.joeyblog.eu.org/joeyblog';
let customECHDomain = 'cloudflare-ech.com';


// ===================== 优化配置区 =====================
// Worker 内存缓存：减少每次订阅实时拉取第三方优选源导致的慢、超时、失败。
// 注意：Cloudflare Worker 冷启动后缓存会清空，这是正常现象；如需强持久缓存，可后续接 KV。
const CACHE_TTL_MS = 20 * 60 * 1000;       // 优选源缓存 20 分钟
const DEFAULT_MAX_NODES = 20;              // 默认最多输出节点数，避免客户端导入太多节点卡顿
const MAX_NODES_HARD_LIMIT = 80;           // 硬限制，防止 URL 参数传入过大
const memoryCache = new Map();

const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];

// ===================== 维护源 / 洛杉矶 VPS 推荐模式 =====================
// DustinWin/BestCF：聚合 CMLiussss、VPS789、CloudFlareYes、微测网等来源，并定时构建。
const BESTCF_BASE = 'https://raw.githubusercontent.com/DustinWin/BestCF/bestcf';
const BESTCF_DOMAIN_URL = `${BESTCF_BASE}/bestcf-domain.txt`;
const BESTCF_IP_URL = `${BESTCF_BASE}/bestcf-ip.txt`;
const BESTCF_CMCC_IP_URL = `${BESTCF_BASE}/cmcc-ip.txt`;
const BESTCF_CUCC_IP_URL = `${BESTCF_BASE}/cucc-ip.txt`;
const BESTCF_CTCC_IP_URL = `${BESTCF_BASE}/ctcc-ip.txt`;

// 甬哥维护域名：yg1 ~ yg11，作为备用域名池，避免一次性塞太多，默认只放前几个。
const YONGGE_DOMAINS = Array.from({ length: 11 }, (_, i) => `yg${i + 1}.ygkkk.dpdns.org`);
const LA_MODE_DEFAULT_TOP = 30;

function clampNumber(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function normalizeWsPath(path) {
    let p = String(path || '/').trim();
    try { p = decodeURIComponent(p); } catch (_) {}
    p = p.replace(/\s+/g, '');
    if (!p.startsWith('/')) p = '/' + p;
    return p || '/';
}

function base64EncodeUnicode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function cacheKey(prefix, ...parts) {
    return `${prefix}:${parts.map(p => encodeURIComponent(typeof p === 'string' ? p : JSON.stringify(p))).join(':')}`;
}

async function getCached(key, ttlMs, fetcher) {
    const now = Date.now();
    const old = memoryCache.get(key);
    if (old && now - old.ts < ttlMs) return old.data;

    try {
        const data = await fetcher();
        // 只有拿到非空结果时才覆盖旧缓存，避免第三方短暂故障把可用缓存冲掉。
        if (Array.isArray(data) && data.length > 0) {
            memoryCache.set(key, { ts: now, data });
        }
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return old?.data || [];
    }
}

async function cachedFetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom) {
    const key = cacheKey('dynamic-ip', ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom);
    return getCached(key, CACHE_TTL_MS, () => fetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom));
}

async function cachedRequestOptimizeAPI(urls, 默认端口 = '443', 超时时间 = 3000) {
    const key = cacheKey('optimize-api', urls, 默认端口, 超时时间);
    return getCached(key, CACHE_TTL_MS, () => 请求优选API(urls, 默认端口, 超时时间));
}

async function cachedFetchAndParseNewIPs(piu) {
    const key = cacheKey('github-ip', piu || defaultIPURL);
    return getCached(key, CACHE_TTL_MS, () => fetchAndParseNewIPs(piu));
}

function splitRemoteListText(text) {
    return String(text || '')
        .replace(/\r/g, ' ')
        .split(/[\n,;\t ]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

async function fetchRemoteTextItems(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 yx-worker',
            'Accept': 'text/plain,*/*'
        }
    });
    if (!response.ok) return [];
    return splitRemoteListText(await response.text());
}

function looksLikeDomain(host) {
    const value = String(host || '').trim().replace(/^\[|\]$/g, '');
    if (!value || value.includes('://') || value.includes('#')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
    if (value.includes(':')) return false;
    return /^[a-zA-Z0-9.-]+$/.test(value) && value.includes('.');
}

async function cachedFetchDomainsFromUrl(url, namePrefix = 'BestCF域名', limit = 20) {
    const key = cacheKey('remote-domains', url, namePrefix, limit);
    return getCached(key, CACHE_TTL_MS, async () => {
        const items = await fetchRemoteTextItems(url);
        const seen = new Set();
        const domains = [];
        for (const item of items) {
            const domain = item.split('#')[0].split(':')[0].trim();
            if (!looksLikeDomain(domain) || seen.has(domain)) continue;
            seen.add(domain);
            domains.push({ ip: domain, name: `${namePrefix}-${domains.length + 1}` });
            if (domains.length >= limit) break;
        }
        return domains;
    });
}

async function cachedFetchAddressListFromUrl(url, defaultPort = 443, limit = 80) {
    const key = cacheKey('remote-addresses', url, defaultPort, limit);
    return getCached(key, CACHE_TTL_MS, async () => {
        const items = await fetchRemoteTextItems(url);
        const list = [];
        const seen = new Set();
        for (const item of items) {
            const parsed = parsePreferredAddress(item, defaultPort);
            if (!parsed) continue;
            const id = `${parsed.ip}:${parsed.port}`;
            if (seen.has(id)) continue;
            seen.add(id);
            list.push(parsed);
            if (list.length >= limit) break;
        }
        return list;
    });
}

function isLosAngelesMode(value) {
    return ['la', 'lax', 'losangeles', 'los-angeles', '洛杉矶'].includes(String(value || '').trim().toLowerCase());
}

function parsePreferredAddress(raw, defaultPort = 443) {
    const text = String(raw || '').trim();
    if (!text) return null;

    const hashIndex = text.indexOf('#');
    const addressPart = (hashIndex >= 0 ? text.slice(0, hashIndex) : text).trim();
    const remark = (hashIndex >= 0 ? text.slice(hashIndex + 1) : '').trim();
    if (!addressPart || addressPart.includes('://')) return null;

    let ip = '';
    let port = defaultPort;

    if (addressPart.startsWith('[')) {
        const match = addressPart.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (!match) return null;
        ip = match[1];
        if (match[2]) port = Number.parseInt(match[2], 10);
    } else {
        const firstColon = addressPart.indexOf(':');
        const lastColon = addressPart.lastIndexOf(':');
        // IPv4/域名:端口
        if (firstColon === lastColon && lastColon > -1 && /^\d+$/.test(addressPart.slice(lastColon + 1))) {
            ip = addressPart.slice(0, lastColon);
            port = Number.parseInt(addressPart.slice(lastColon + 1), 10);
        } else {
            // 域名、IPv4 无端口，或裸 IPv6 无端口
            ip = addressPart;
        }
    }

    if (!ip || !Number.isFinite(port)) return null;
    return {
        ip: ip.trim().replace(/^\[|\]$/g, ''),
        port,
        name: remark || ip.trim().replace(/^\[|\]$/g, '')
    };
}

function dedupeLinks(links) {
    const seen = new Set();
    const result = [];
    for (const link of links) {
        const key = String(link).split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(link);
    }
    return result;
}

function limitLinks(links, maxNodes) {
    const limit = clampNumber(maxNodes, 1, MAX_NODES_HARD_LIMIT, DEFAULT_MAX_NODES);
    return links.slice(0, limit);
}

function yamlQuote(value) {
    return JSON.stringify(String(value ?? '').replace(/\u0000/g, ''));
}

function getNodeNameFromLink(link, index) {
    const raw = String(link).split('#')[1] || `节点${index + 1}`;
    try { return decodeURIComponent(raw); } catch (_) { return raw; }
}

function parseProxyLink(link, index) {
    try {
        const u = new URL(link);
        const type = u.protocol.replace(':', '');
        if (!['vless', 'trojan'].includes(type)) return null;
        const echParam = u.searchParams.get('ech');
        return {
            type,
            name: getNodeNameFromLink(link, index),
            server: u.hostname.replace(/^\[|\]$/g, ''),
            port: Number.parseInt(u.port || '443', 10),
            credential: decodeURIComponent(u.username || ''),
            tls: u.searchParams.get('security') === 'tls',
            path: normalizeWsPath(u.searchParams.get('path') || '/'),
            host: u.searchParams.get('host') || u.searchParams.get('sni') || '',
            sni: u.searchParams.get('sni') || '',
            echDomain: echParam ? decodeURIComponent(echParam).split('+')[0] : ''
        };
    } catch (e) {
        return null;
    }
}

// 默认优选域名列表
// 说明：控制在较小规模，避免 top=20 时全被域名占满；分运营商/通用优选 IP 由下方 BestCF 源补充。
const directDomains = [
    { name: 'BestCF-030101', domain: 'bestcf.030101.xyz' },
    { name: 'BestCF-182682', domain: 'bestcf.cloudflare.182682.xyz' },
    { name: 'CF-182682', domain: 'cf.cloudflare.182682.xyz' },
    { name: 'BestCF-top', domain: 'bestcf.top' },
    { name: 'CFIP-cfcdn', domain: 'cfip.cfcdn.vip' },
    { name: 'youxuan-cf090227', domain: 'youxuan.cf.090227.xyz' },
    { name: 'cf090227', domain: 'cf.090227.xyz' },
    { name: 'cdn2020111', domain: 'cdn.2020111.xyz' },
    { name: 'cf0sm', domain: 'cf.0sm.com' },
    { name: 'saas-sin-fan', domain: 'saas.sin.fan' },
    { name: 'xn-b6gac', domain: 'xn--b6gac.eu.org' },
    { name: 'yongge-1', domain: YONGGE_DOMAINS[0] },
    { name: 'yongge-2', domain: YONGGE_DOMAINS[1] },
    { name: 'yongge-3', domain: YONGGE_DOMAINS[2] }
];

// 默认优选IP来源URL：使用 DustinWin/BestCF 通用 CF 优选 IP 源；也可在页面 GitHub 优选URL中覆盖。
const defaultIPURL = BESTCF_IP_URL;

// UUID验证
function isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

// 从环境变量获取配置
function getConfigValue(key, defaultValue) {
    return defaultValue || '';
}

// 获取动态IP列表（支持IPv4/IPv6和运营商筛选）
async function fetchDynamicIPs(ipv4Enabled = true, ipv6Enabled = true, ispMobile = true, ispUnicom = true, ispTelecom = true) {
    const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
    const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
    let results = [];

    try {
        const fetchPromises = [];
        if (ipv4Enabled) {
            fetchPromises.push(fetchAndParseWetest(v4Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }
        if (ipv6Enabled) {
            fetchPromises.push(fetchAndParseWetest(v6Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }

        const [ipv4List, ipv6List] = await Promise.all(fetchPromises);
        results = [...ipv4List, ...ipv6List];
        
        // 按运营商筛选
        if (results.length > 0) {
            results = results.filter(item => {
                const isp = item.isp || '';
                if (isp.includes('移动') && !ispMobile) return false;
                if (isp.includes('联通') && !ispUnicom) return false;
                if (isp.includes('电信') && !ispTelecom) return false;
                return true;
            });
        }
        
        return results.length > 0 ? results : [];
    } catch (e) {
        return [];
    }
}

// 解析wetest页面
async function fetchAndParseWetest(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return [];
        const html = await response.text();
        const results = [];
        const rowRegex = /<tr[\s\S]*?<\/tr>/g;
        const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>[\s\S]*?<td data-label="数据中心">(.+?)<\/td>/;

        let match;
        while ((match = rowRegex.exec(html)) !== null) {
            const rowHtml = match[0];
            const cellMatch = rowHtml.match(cellRegex);
            if (cellMatch && cellMatch[1] && cellMatch[2]) {
                const colo = cellMatch[3] ? cellMatch[3].trim().replace(/<.*?>/g, '') : '';
                results.push({
                    isp: cellMatch[1].trim().replace(/<.*?>/g, ''),
                    ip: cellMatch[2].trim(),
                    colo: colo
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 整理成数组
async function 整理成数组(内容) {
    var 替换后的内容 = 内容.replace(/[	"'\r\n]+/g, ',').replace(/,+/g, ',');
    if (替换后的内容.charAt(0) == ',') 替换后的内容 = 替换后的内容.slice(1);
    if (替换后的内容.charAt(替换后的内容.length - 1) == ',') 替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
    const 地址数组 = 替换后的内容.split(',');
    return 地址数组;
}

// 请求优选API
async function 请求优选API(urls, 默认端口 = '443', 超时时间 = 3000) {
    if (!urls?.length) return [];
    const results = new Set();
    await Promise.allSettled(urls.map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 超时时间);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            let text = '';
            try {
                const buffer = await response.arrayBuffer();
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                const charset = contentType.match(/charset=([^\s;]+)/i)?.[1]?.toLowerCase() || '';

                // 根据 Content-Type 响应头判断编码优先级
                let decoders = ['utf-8', 'gb2312']; // 默认优先 UTF-8
                if (charset.includes('gb') || charset.includes('gbk') || charset.includes('gb2312')) {
                    decoders = ['gb2312', 'utf-8']; // 如果明确指定 GB 系编码，优先尝试 GB2312
                }

                // 尝试多种编码解码
                let decodeSuccess = false;
                for (const decoder of decoders) {
                    try {
                        const decoded = new TextDecoder(decoder).decode(buffer);
                        // 验证解码结果的有效性
                        if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                            text = decoded;
                            decodeSuccess = true;
                            break;
                        } else if (decoded && decoded.length > 0) {
                            // 如果有替换字符 (U+FFFD)，说明编码不匹配，继续尝试下一个编码
                            continue;
                        }
                    } catch (e) {
                        // 该编码解码失败，尝试下一个
                        continue;
                    }
                }

                // 如果所有编码都失败或无效，尝试 response.text()
                if (!decodeSuccess) {
                    text = await response.text();
                }

                // 如果返回的是空或无效数据，返回
                if (!text || text.trim().length === 0) {
                    return;
                }
            } catch (e) {
                console.error('Failed to decode response:', e);
                return;
            }
            const csvLines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l);
            const isCSV = csvLines.length > 1 && csvLines[0].includes(',');
            const lines = isCSV ? csvLines : splitRemoteListText(text);
            const IPV6_PATTERN = /^[^\[\]]*:[^\[\]]*:[^\[\]]/;
            if (!isCSV) {
                lines.forEach(line => {
                    const hashIndex = line.indexOf('#');
                    const [hostPart, remark] = hashIndex > -1 ? [line.substring(0, hashIndex), line.substring(hashIndex)] : [line, ''];
                    let hasPort = false;
                    if (hostPart.startsWith('[')) {
                        hasPort = /\]:(\d+)$/.test(hostPart);
                    } else {
                        const colonIndex = hostPart.lastIndexOf(':');
                        hasPort = colonIndex > -1 && /^\d+$/.test(hostPart.substring(colonIndex + 1));
                    }
                    const port = new URL(url).searchParams.get('port') || 默认端口;
                    results.add(hasPort ? line : `${hostPart}:${port}${remark}`);
                });
            } else {
                const headers = lines[0].split(',').map(h => h.trim());
                const dataLines = lines.slice(1);
                if (headers.includes('IP地址') && headers.includes('端口') && headers.includes('数据中心')) {
                    const ipIdx = headers.indexOf('IP地址'), portIdx = headers.indexOf('端口');
                    const remarkIdx = headers.indexOf('国家') > -1 ? headers.indexOf('国家') :
                        headers.indexOf('城市') > -1 ? headers.indexOf('城市') : headers.indexOf('数据中心');
                    const tlsIdx = headers.indexOf('TLS');
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        if (tlsIdx !== -1 && cols[tlsIdx]?.toLowerCase() !== 'true') return;
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${cols[portIdx]}#${cols[remarkIdx]}`);
                    });
                } else if (headers.some(h => h.includes('IP')) && headers.some(h => h.includes('延迟')) && headers.some(h => h.includes('下载速度'))) {
                    const ipIdx = headers.findIndex(h => h.includes('IP'));
                    const delayIdx = headers.findIndex(h => h.includes('延迟'));
                    const speedIdx = headers.findIndex(h => h.includes('下载速度'));
                    const port = new URL(url).searchParams.get('port') || 默认端口;
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${port}#CF优选 ${cols[delayIdx]}ms ${cols[speedIdx]}MB/s`);
                    });
                }
            }
        } catch (e) { }
    }));
    return Array.from(results);
}

// 从GitHub/Raw 文本源获取优选IP（支持空格、换行、逗号分隔；支持 IP、IP:端口、IP#备注、[IPv6]:端口#备注）
async function fetchAndParseNewIPs(piu) {
    const url = piu || defaultIPURL;
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 yx-worker',
                'Accept': 'text/plain,*/*'
            }
        });
        if (!response.ok) return [];
        const text = await response.text();
        const items = splitRemoteListText(text);
        const results = [];
        const seen = new Set();

        for (const item of items) {
            const parsed = parsePreferredAddress(item, 443);
            if (!parsed) continue;
            const key = `${parsed.ip}:${parsed.port}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(parsed);
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 生成VLESS链接
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: false });
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    encryption: 'none', 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-WS`;
                const wsParams = new URLSearchParams({
                    encryption: 'none',
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成Trojan链接
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const password = user;  // Trojan使用UUID作为密码

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS`;
                const wsParams = new URLSearchParams({
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成VMess链接 (已修复中文名导致1101报错的问题)
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const vmessConfig = {
                v: "2",
                ps: tls ? `${nodeNameBase}-${port}-VMess-WS-TLS` : `${nodeNameBase}-${port}-VMess-WS`,
                add: safeIP,
                port: port.toString(),
                id: user,
                aid: "0",
                scy: "auto",
                net: "ws",
                type: "none",
                host: workerDomain,
                path: wsPath,
                tls: tls ? "tls" : "none"
            };
            if (tls) {
                vmessConfig.sni = workerDomain;
                vmessConfig.fp = "chrome";
            }
            
            // 核心修复：处理中文编码，防止 btoa 报错
            const jsonStr = JSON.stringify(vmessConfig);
            const vmessBase64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
            }));
            
            links.push(`vmess://${vmessBase64}`);
        });
    });
    return links;
}

// 从GitHub IP生成链接（VLESS）
function generateLinksFromNewIPs(list, user, workerDomain, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';
    const echSuffix = echConfig ? `&alpn=h3%2Ch2%2Chttp%2F1.1&ech=${encodeURIComponent(echConfig)}` : '';
    
    list.forEach(item => {
        const nodeName = item.name.replace(/\s/g, '_');
        const port = item.port;
        
        if (CF_HTTPS_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}${echSuffix}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else if (CF_HTTP_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=none&type=ws&host=${workerDomain}&path=${wsPath}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}${echSuffix}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        }
    });
    return links;
}

// 生成订阅内容
async function handleSubscriptionRequest(request, user, customDomain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, echConfig = null, maxNodes = DEFAULT_MAX_NODES, sourceFlags = { epd: true, epi: true, egi: true }) {
    const url = new URL(request.url);
    const finalLinks = [];
    const workerDomain = url.hostname;  // workerDomain始终是请求的hostname
    const nodeDomain = customDomain || url.hostname;  // 用户输入的域名用于生成节点时的host/sni
    const target = url.searchParams.get('target') || 'base64';
    const wsPath = normalizeWsPath(customPath || '/');
    const profile = url.searchParams.get('mode') || url.searchParams.get('profile') || '';
    const laMode = isLosAngelesMode(profile);
    const maxOutputNodes = laMode && !url.searchParams.has('top')
        ? LA_MODE_DEFAULT_TOP
        : clampNumber(maxNodes, 1, MAX_NODES_HARD_LIMIT, DEFAULT_MAX_NODES);

    async function addNodesFromList(list) {
        if (!Array.isArray(list) || list.length === 0) return;
        const hasProtocol = evEnabled || etEnabled || vmEnabled;
        const useVL = hasProtocol ? evEnabled : true;  // 如果没有选择任何协议，默认使用VLESS
        
        if (useVL) {
            finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (etEnabled) {
            finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (vmEnabled) {
            finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
    }

    // 原生地址
    await addNodesFromList([{ ip: workerDomain, isp: '原生地址' }]);

    // 优选域名：内置稳定域名 + 洛杉矶模式下少量补充 BestCF 动态域名
    if (sourceFlags.epd) {
        const domainList = directDomains.map(d => ({ ip: d.domain, isp: d.name || d.domain }));
        await addNodesFromList(domainList);
        if (laMode) {
            const bestcfDomains = await cachedFetchDomainsFromUrl(BESTCF_DOMAIN_URL, 'BestCF动态域名', 6);
            await addNodesFromList(bestcfDomains);
        }
    }

    // 优选IP：加入缓存，第三方源失败时不影响已有缓存
    if (sourceFlags.epi) {
        try {
            const dynamicIPList = await cachedFetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom);
            await addNodesFromList(dynamicIPList);
        } catch (error) {
            console.error('获取动态IP失败:', error);
        }
    }

    // 洛杉矶 VPS 推荐模式：额外接入 BestCF 通用 + 分运营商优选 IP 源。
    // 这些源会按上方移动/联通/电信勾选项自动取舍，适合洛杉矶源站配合客户端 url-test/fallback 使用。
    if (laMode && sourceFlags.egi) {
        try {
            const sourceUrls = [BESTCF_IP_URL];
            if (ispMobile) sourceUrls.push(BESTCF_CMCC_IP_URL);
            if (ispUnicom) sourceUrls.push(BESTCF_CUCC_IP_URL);
            if (ispTelecom) sourceUrls.push(BESTCF_CTCC_IP_URL);
            for (const sourceUrl of sourceUrls) {
                const list = await cachedFetchAddressListFromUrl(sourceUrl, 443, 40);
                await addNodesFromList(list);
            }
        } catch (error) {
            console.error('洛杉矶模式 BestCF 源获取失败:', error);
        }
    }

    // GitHub优选 / 自定义优选API：统一解析后交给 addNodesFromList，保证 VLESS/Trojan/VMess 选择都生效
    if (sourceFlags.egi) {
        try {
            if (piu && piu.toLowerCase().startsWith('https://')) {
                const 优选API的IP = await cachedRequestOptimizeAPI([piu]);
                const IP列表 = 优选API的IP.map(item => parsePreferredAddress(item, 443)).filter(Boolean);
                await addNodesFromList(IP列表);
            } else if (piu && piu.includes('\n')) {
                const 完整优选列表 = await 整理成数组(piu);
                const 优选API = [], 优选IP = [];
                for (const 元素 of 完整优选列表) {
                    if (元素.toLowerCase().startsWith('https://')) {
                        优选API.push(元素);
                    } else if (!元素.toLowerCase().includes('://')) {
                        优选IP.push(元素);
                    }
                }
                if (优选API.length > 0) {
                    优选IP.push(...await cachedRequestOptimizeAPI(优选API));
                }
                const IP列表 = 优选IP.map(item => parsePreferredAddress(item, 443)).filter(Boolean);
                await addNodesFromList(IP列表);
            } else {
                const newIPList = await cachedFetchAndParseNewIPs(piu);
                await addNodesFromList(newIPList);
            }
        } catch (error) {
            console.error('获取优选IP失败:', error);
        }
    }

    let outputLinks = limitLinks(dedupeLinks(finalLinks), maxOutputNodes);

    if (outputLinks.length === 0) {
        const errorRemark = '所有节点获取失败';
        const errorLink = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=ws&host=error.com&path=%2F#${encodeURIComponent(errorRemark)}`;
        outputLinks = [errorLink];
    }

    let subscriptionContent;
    let contentType = 'text/plain; charset=utf-8';
    
    switch (target.toLowerCase()) {
        case 'clash':
        case 'clashr':
            subscriptionContent = generateClashConfig(outputLinks);
            contentType = 'text/yaml; charset=utf-8';
            break;
        case 'surge':
        case 'surge2':
        case 'surge3':
        case 'surge4':
            subscriptionContent = generateSurgeConfig(outputLinks);
            break;
        case 'quantumult':
        case 'quanx':
            subscriptionContent = generateQuantumultConfig(outputLinks);
            break;
        default:
            subscriptionContent = base64EncodeUnicode(outputLinks.join('\n'));
    }
    
    return new Response(subscriptionContent, {
        headers: { 
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'X-Node-Count': String(outputLinks.length),
            'X-Node-Limit': String(maxOutputNodes),
            'X-Source-Cache-TTL': String(Math.floor(CACHE_TTL_MS / 1000))
        },
    });
}

// 生成Clash配置（增强版：转义名称、支持VLESS/Trojan、自动过滤VMess）
function generateClashConfig(links) {
    let yaml = 'port: 7890\n';
    yaml += 'socks-port: 7891\n';
    yaml += 'allow-lan: false\n';
    yaml += 'mode: rule\n';
    yaml += 'log-level: info\n\n';
    yaml += 'proxies:\n';
    
    const proxyNames = [];
    links.forEach((link, index) => {
        const p = parseProxyLink(link, index);
        if (!p) return;
        proxyNames.push(p.name);

        yaml += `  - name: ${yamlQuote(p.name)}\n`;
        yaml += `    type: ${p.type}\n`;
        yaml += `    server: ${yamlQuote(p.server)}\n`;
        yaml += `    port: ${p.port}\n`;
        if (p.type === 'vless') {
            yaml += `    uuid: ${yamlQuote(p.credential)}\n`;
            yaml += `    flow: \"\"\n`;
        } else if (p.type === 'trojan') {
            yaml += `    password: ${yamlQuote(p.credential)}\n`;
        }
        yaml += `    tls: ${p.tls}\n`;
        if (p.sni) yaml += `    servername: ${yamlQuote(p.sni)}\n`;
        yaml += `    network: ws\n`;
        yaml += `    ws-opts:\n`;
        yaml += `      path: ${yamlQuote(p.path)}\n`;
        yaml += `      headers:\n`;
        yaml += `        Host: ${yamlQuote(p.host)}\n`;
        if (p.echDomain) {
            yaml += `    ech-opts:\n`;
            yaml += `      enable: true\n`;
            yaml += `      query-server-name: ${yamlQuote(p.echDomain)}\n`;
        }
    });
    
    yaml += '\nproxy-groups:\n';
    yaml += '  - name: PROXY\n';
    yaml += '    type: url-test\n';
    yaml += '    url: http://www.gstatic.com/generate_204\n';
    yaml += '    interval: 300\n';
    yaml += '    tolerance: 50\n';
    yaml += `    proxies: [${proxyNames.map(yamlQuote).join(', ')}]\n`;
    yaml += '  - name: FALLBACK\n';
    yaml += '    type: fallback\n';
    yaml += '    url: http://www.gstatic.com/generate_204\n';
    yaml += '    interval: 300\n';
    yaml += `    proxies: [${proxyNames.map(yamlQuote).join(', ')}]\n`;
    yaml += '\nrules:\n';
    yaml += '  - DOMAIN-SUFFIX,local,DIRECT\n';
    yaml += '  - IP-CIDR,127.0.0.0/8,DIRECT\n';
    yaml += '  - GEOIP,CN,DIRECT\n';
    yaml += '  - MATCH,PROXY\n';
    
    return yaml;
}

// 生成Surge配置
function generateSurgeConfig(links) {
    let config = '[Proxy]\n';
    const names = [];
    links.forEach((link, index) => {
        const p = parseProxyLink(link, index);
        if (!p) return;
        names.push(p.name);
        if (p.type === 'vless') {
            config += `${p.name} = vless, ${p.server}, ${p.port}, username=${p.credential}, tls=${p.tls}, ws=true, ws-path=${p.path}, ws-headers=Host:${p.host}`;
        } else if (p.type === 'trojan') {
            config += `${p.name} = trojan, ${p.server}, ${p.port}, password=${p.credential}, tls=${p.tls}, ws=true, ws-path=${p.path}, ws-headers=Host:${p.host}`;
        }
        if (p.sni) config += `, sni=${p.sni}`;
        config += '\n';
    });
    config += '\n[Proxy Group]\nPROXY = url-test, ' + names.join(', ') + ', url=http://www.gstatic.com/generate_204, interval=300\n';
    return config;
}

// 生成Quantumult配置
function generateQuantumultConfig(links) {
    return base64EncodeUnicode(links.join('\n'));
}

// 生成iOS 26风格的主页
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>服务器优选工具</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 50%, #fafafa 100%);
            color: #1d1d1f;
            min-height: 100vh;
            padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
            overflow-x: hidden;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            padding: 48px 20px 32px;
        }
        
        .header h1 {
            font-size: 40px;
            font-weight: 700;
            letter-spacing: -0.3px;
            color: #1d1d1f;
            margin-bottom: 8px;
            line-height: 1.1;
        }
        
        .header p {
            font-size: 17px;
            color: #86868b;
            font-weight: 400;
            line-height: 1.5;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.75);
            backdrop-filter: blur(30px) saturate(200%);
            -webkit-backdrop-filter: blur(30px) saturate(200%);
            border-radius: 24px;
            padding: 28px;
            margin-bottom: 20px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.05);
            border: 0.5px solid rgba(0, 0, 0, 0.06);
            will-change: transform;
        }
        
        .form-group {
            margin-bottom: 24px;
        }
        
        .form-group:last-child {
            margin-bottom: 0;
        }
        
        .form-group label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: #86868b;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .form-group input,
        .form-group textarea {
            width: 100%;
            padding: 14px 16px;
            font-size: 17px;
            font-weight: 400;
            color: #1d1d1f;
            background: rgba(142, 142, 147, 0.12);
            border: 2px solid transparent;
            border-radius: 12px;
            outline: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            -webkit-appearance: none;
        }
        
        .form-group input:focus,
        .form-group textarea:focus {
            background: rgba(142, 142, 147, 0.16);
            border-color: #007AFF;
            transform: scale(1.005);
        }
        
        .form-group input::placeholder,
        .form-group textarea::placeholder {
            color: #86868b;
        }
        
        .form-group small {
            display: block;
            margin-top: 8px;
            color: #86868b;
            font-size: 13px;
            line-height: 1.4;
        }
        
        .list-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 0;
            min-height: 52px;
            cursor: pointer;
            border-bottom: 0.5px solid rgba(0, 0, 0, 0.08);
            transition: background-color 0.15s ease;
        }
        
        .list-item:last-child {
            border-bottom: none;
        }
        
        .list-item:active {
            background-color: rgba(142, 142, 147, 0.08);
            margin: 0 -28px;
            padding-left: 28px;
            padding-right: 28px;
        }
        
        .list-item-label {
            font-size: 17px;
            font-weight: 400;
            color: #1d1d1f;
            flex: 1;
        }
        
        .list-item-description {
            font-size: 13px;
            color: #86868b;
            margin-top: 4px;
            line-height: 1.4;
        }
        
        .switch {
            position: relative;
            width: 51px;
            height: 31px;
            background: rgba(142, 142, 147, 0.3);
            border-radius: 16px;
            transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            flex-shrink: 0;
        }
        
        .switch.active {
            background: #34C759;
        }
        
        .switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 27px;
            height: 27px;
            background: #ffffff;
            border-radius: 50%;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        .switch.active::after {
            transform: translateX(20px);
        }
        
        .btn {
            width: 100%;
            padding: 16px;
            font-size: 17px;
            font-weight: 600;
            color: #ffffff;
            background: #007AFF;
            border: none;
            border-radius: 14px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            margin-top: 8px;
            -webkit-appearance: none;
            box-shadow: 0 4px 12px rgba(0, 122, 255, 0.25);
            will-change: transform;
        }
        
        .btn:hover {
            background: #0051D5;
            box-shadow: 0 6px 16px rgba(0, 122, 255, 0.3);
        }
        
        .btn:active {
            transform: scale(0.97);
            box-shadow: 0 2px 8px rgba(0, 122, 255, 0.2);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .btn-secondary {
            background: rgba(142, 142, 147, 0.12);
            color: #007AFF;
            box-shadow: none;
        }
        
        .btn-secondary:hover {
            background: rgba(142, 142, 147, 0.16);
        }
        
        .btn-secondary:active {
            background: rgba(142, 142, 147, 0.2);
        }
        
        .result {
            margin-top: 20px;
            padding: 16px;
            background: rgba(142, 142, 147, 0.12);
            border-radius: 12px;
            font-size: 15px;
            color: #1d1d1f;
            word-break: break-all;
            display: none;
            line-height: 1.5;
        }
        
        .result.show {
            display: block;
        }
        
        .result-card {
            padding: 16px;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 12px;
            margin-bottom: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
            border: 0.5px solid rgba(0, 0, 0, 0.06);
        }
        
        .result-url {
            margin-top: 12px;
            padding: 12px;
            background: rgba(0, 122, 255, 0.1);
            border-radius: 10px;
            font-size: 13px;
            color: #007aff;
            word-break: break-all;
            line-height: 1.5;
        }
        
        .copy-btn {
            margin-top: 8px;
            padding: 10px 16px;
            font-size: 15px;
            background: rgba(0, 122, 255, 0.1);
            color: #007aff;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .copy-btn:active {
            background: rgba(0, 122, 255, 0.2);
            transform: scale(0.98);
        }
        
        .client-btn {
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 500;
            color: #007AFF;
            background: rgba(0, 122, 255, 0.1);
            border: 1px solid rgba(0, 122, 255, 0.2);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            -webkit-appearance: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }
        
        .client-btn:active {
            transform: scale(0.97);
            background: rgba(0, 122, 255, 0.2);
            border-color: rgba(0, 122, 255, 0.3);
        }
        
        .checkbox-label {
            display: flex;
            align-items: center;
            cursor: pointer;
            font-size: 17px;
            font-weight: 400;
            user-select: none;
            -webkit-user-select: none;
            position: relative;
            z-index: 1;
            padding: 8px 0;
        }
        
        .checkbox-label input[type="checkbox"] {
            margin-right: 12px;
            width: 22px;
            height: 22px;
            cursor: pointer;
            flex-shrink: 0;
            position: relative;
            z-index: 2;
            -webkit-appearance: checkbox;
            appearance: checkbox;
        }
        
        .checkbox-label span {
            cursor: pointer;
            position: relative;
            z-index: 1;
        }
        
        @media (max-width: 480px) {
            .client-btn {
                font-size: 12px;
                padding: 10px 12px;
            }
            
            .header h1 {
                font-size: 34px;
            }
        }
        
        .footer {
            text-align: center;
            padding: 32px 20px;
            color: #86868b;
            font-size: 13px;
        }
        
        .footer a {
            color: #007AFF;
            text-decoration: none;
            font-weight: 500;
            transition: opacity 0.2s ease;
        }
        
        .footer a:active {
            opacity: 0.6;
        }
        
        @media (prefers-color-scheme: dark) {
            body {
                background: linear-gradient(180deg, #000000 0%, #1c1c1e 50%, #2c2c2e 100%);
                color: #f5f5f7;
            }
            
            .card {
                background: rgba(28, 28, 30, 0.75);
                border: 0.5px solid rgba(255, 255, 255, 0.12);
                box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            
            .form-group input,
            .form-group textarea {
                background: rgba(142, 142, 147, 0.2);
                color: #f5f5f7;
            }
            
            .form-group input:focus,
            .form-group textarea:focus {
                background: rgba(142, 142, 147, 0.25);
                border-color: #5ac8fa;
            }
            
            .list-item {
                border-bottom-color: rgba(255, 255, 255, 0.1);
            }
            
            .list-item:active {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            .list-item-label {
                color: #f5f5f7;
            }
            
            .switch {
                background: rgba(142, 142, 147, 0.4);
            }
            
            .switch.active {
                background: #30d158;
            }
            
            .switch::after {
                background: #ffffff;
            }
            
            .result {
                background: rgba(142, 142, 147, 0.2);
                color: #f5f5f7;
            }
            
            .result-card {
                background: rgba(28, 28, 30, 0.9);
                border-color: rgba(255, 255, 255, 0.1);
            }
            
            .checkbox-label span {
                color: #f5f5f7;
            }
            
            .client-btn {
                background: rgba(0, 122, 255, 0.15) !important;
                border-color: rgba(0, 122, 255, 0.3) !important;
                color: #5ac8fa !important;
            }
            
            .footer a {
                color: #5ac8fa !important;
            }
            
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>服务器优选工具</h1>
            <p>智能优选 • 一键生成</p>
        </div>
        
        <div class="card">
            <div class="form-group">
                <label>域名</label>
                <input type="text" id="domain" placeholder="请输入您的域名">
            </div>
            
            <div class="form-group">
                <label>UUID/Password</label>
                <input type="text" id="uuid" placeholder="请输入UUID或Password">
            </div>

            <div class="form-group">
                <label>订阅Token（可选）</label>
                <input type="text" id="subToken" placeholder="Worker设置了 SUB_TOKEN 时填写">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">未设置 SUB_TOKEN 可留空；设置后可防止别人拿到UUID就拉取订阅。</small>
            </div>
            
            <div class="form-group">
                <label>WebSocket路径（可选）</label>
                <input type="text" id="customPath" placeholder="留空则使用默认路径 /" value="/">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">自定义WebSocket路径，例如：/v2ray 或 /cdn-a8f3</small>
            </div>

            <div class="form-group">
                <label>最大输出节点数</label>
                <input type="number" id="maxNodes" placeholder="建议 10-30" value="20" min="1" max="80">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">建议只保留 Top 10～30，节点过多会拖慢客户端测速和导入。</small>
            </div>

            <div class="list-item" onclick="toggleSwitch('switchLA')">
                <div>
                    <div class="list-item-label">洛杉矶 VPS 推荐模式</div>
                    <div class="list-item-description">启用后自动接入 BestCF 通用及分运营商源，建议输出 30 个节点。</div>
                </div>
                <div class="switch" id="switchLA"></div>
            </div>
            
            <div class="list-item" onclick="toggleSwitch('switchDomain')">
                <div>
                    <div class="list-item-label">启用优选域名</div>
                </div>
                <div class="switch active" id="switchDomain"></div>
            </div>
            
            <div class="list-item" onclick="toggleSwitch('switchIP')">
                <div>
                    <div class="list-item-label">启用优选IP</div>
                </div>
                <div class="switch active" id="switchIP"></div>
            </div>
            
            <div class="list-item" onclick="toggleSwitch('switchGitHub')">
                <div>
                    <div class="list-item-label">启用GitHub优选</div>
                </div>
                <div class="switch active" id="switchGitHub"></div>
            </div>
            
            <div class="form-group" id="githubUrlGroup" style="margin-top: 12px;">
                <label>GitHub优选URL（可选）</label>
                <input type="text" id="githubUrl" placeholder="留空则使用默认地址" style="font-size: 15px;">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">自定义优选IP列表来源URL，留空则使用默认地址</small>
            </div>
            
            <div class="form-group" style="margin-top: 24px;">
                <label>协议选择</label>
                <div style="margin-top: 8px;">
                    <div class="list-item" onclick="toggleSwitch('switchVL')">
                        <div>
                            <div class="list-item-label">VLESS (vl)</div>
                        </div>
                        <div class="switch active" id="switchVL"></div>
                    </div>
                    <div class="list-item" onclick="toggleSwitch('switchTJ')">
                        <div>
                            <div class="list-item-label">Trojan (tj)</div>
                        </div>
                        <div class="switch" id="switchTJ"></div>
                    </div>
                    <div class="list-item" onclick="toggleSwitch('switchVM')">
                        <div>
                            <div class="list-item-label">VMess (vm)</div>
                        </div>
                        <div class="switch" id="switchVM"></div>
                    </div>
                </div>
            </div>
            
            <div class="form-group" style="margin-top: 24px;">
                <label>客户端选择</label>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 8px;">
                    <button type="button" class="client-btn" onclick="generateClientLink('clash', 'CLASH')">CLASH</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('clash', 'STASH')">STASH</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('surge', 'SURGE')">SURGE</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('sing-box', 'SING-BOX')">SING-BOX</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('loon', 'LOON')">LOON</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('quanx', 'QUANTUMULT X')" style="font-size: 13px;">QUANTUMULT X</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'V2RAY')">V2RAY</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'V2RAYNG')">V2RAYNG</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'NEKORAY')">NEKORAY</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'Shadowrocket')" style="font-size: 13px;">Shadowrocket</button>
                </div>
                <div class="result-url" id="clientSubscriptionUrl" style="display: none; margin-top: 12px; padding: 12px; background: rgba(0, 122, 255, 0.1); border-radius: 8px; font-size: 13px; color: #007aff; word-break: break-all;"></div>
            </div>
            
            <div class="form-group">
                <label>IP版本选择</label>
                <div style="display: flex; gap: 16px; margin-top: 8px;">
                    <label class="checkbox-label">
                        <input type="checkbox" id="ipv4Enabled" checked>
                        <span>IPv4</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ipv6Enabled" checked>
                        <span>IPv6</span>
                    </label>
                </div>
            </div>
            
            <div class="form-group">
                <label>运营商选择</label>
                <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px;">
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispMobile" checked>
                        <span>移动</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispUnicom" checked>
                        <span>联通</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispTelecom" checked>
                        <span>电信</span>
                    </label>
                </div>
            </div>
            
            <div class="list-item" onclick="toggleSwitch('switchTLS')" style="margin-top: 8px;">
                <div>
                    <div class="list-item-label">仅TLS节点</div>
                    <div class="list-item-description">启用后只生成带TLS的节点，不生成非TLS节点（如80端口）</div>
                </div>
                <div class="switch active" id="switchTLS"></div>
            </div>
            
            <div class="list-item" onclick="toggleSwitch('switchECH')" style="margin-top: 8px;">
                <div>
                    <div class="list-item-label">ECH (Encrypted Client Hello)</div>
                    <div class="list-item-description">启用后节点链接将携带 ECH 参数，需客户端支持；开启时自动仅TLS</div>
                </div>
                <div class="switch" id="switchECH"></div>
            </div>
            <div class="form-group" id="echOptionsGroup" style="margin-top: 12px; display: none;">
                <label>ECH 自定义 DNS（可选）</label>
                <input type="text" id="customDNS" placeholder="例如: https://dns.joeyblog.eu.org/joeyblog" style="font-size: 14px;">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">用于 ECH 配置查询的 DoH 地址</small>
                <label style="margin-top: 12px; display: block;">ECH 域名（可选）</label>
                <input type="text" id="customECHDomain" placeholder="例如: cloudflare-ech.com" style="font-size: 14px;">
            </div>
        </div>
        
        <div class="footer">
            <p>简化版优选工具 • 仅用于节点生成</p>
            <div style="margin-top: 20px; display: flex; justify-content: center; gap: 24px; flex-wrap: wrap;">
                <a href="https://github.com/byJoey/yx-auto" target="_blank" style="color: #007aff; text-decoration: none; font-size: 15px; font-weight: 500;">GitHub 项目</a>
                <a href="https://www.youtube.com/@joeyblog" target="_blank" style="color: #007aff; text-decoration: none; font-size: 15px; font-weight: 500;">YouTube @joeyblog</a>
            </div>
        </div>
    </div>
    
    <script>
        let switches = {
            switchDomain: true,
            switchIP: true,
            switchGitHub: true,
            switchLA: false,
            switchVL: true,
            switchTJ: false,
            switchVM: false,
            switchTLS: true,
            switchECH: false
        };
        
        function toggleSwitch(id) {
            const switchEl = document.getElementById(id);
            switches[id] = !switches[id];
            switchEl.classList.toggle('active');
            if (id === 'switchECH') {
                const echOpt = document.getElementById('echOptionsGroup');
                if (echOpt) echOpt.style.display = switches.switchECH ? 'block' : 'none';
                if (switches.switchECH && !switches.switchTLS) {
                    switches.switchTLS = true;
                    const tlsEl = document.getElementById('switchTLS');
                    if (tlsEl) tlsEl.classList.add('active');
                }
            }
            if (id === 'switchLA') {
                const maxNodesInput = document.getElementById('maxNodes');
                if (maxNodesInput && switches.switchLA && (!maxNodesInput.value || maxNodesInput.value === '20')) {
                    maxNodesInput.value = '30';
                }
            }
        }
        
        
        // 订阅转换地址（从服务器注入）
        const SUB_CONVERTER_URL = "${ scu }";
        
        function tryOpenApp(schemeUrl, fallbackCallback, timeout) {
            timeout = timeout || 2500;
            let appOpened = false;
            let callbackExecuted = false;
            const startTime = Date.now();
            
            const blurHandler = () => {
                const elapsed = Date.now() - startTime;
                if (elapsed < 3000 && !callbackExecuted) {
                    appOpened = true;
                }
            };
            
            window.addEventListener('blur', blurHandler);
            
            const hiddenHandler = () => {
                const elapsed = Date.now() - startTime;
                if (elapsed < 3000 && !callbackExecuted) {
                    appOpened = true;
                }
            };
            
            document.addEventListener('visibilitychange', hiddenHandler);
            
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.src = schemeUrl;
            document.body.appendChild(iframe);
            
            setTimeout(() => {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                window.removeEventListener('blur', blurHandler);
                document.removeEventListener('visibilitychange', hiddenHandler);
                
                if (!callbackExecuted) {
                    callbackExecuted = true;
                    if (!appOpened && fallbackCallback) {
                        fallbackCallback();
                    }
                }
            }, timeout);
        }
        
        function generateClientLink(clientType, clientName) {
            const domain = document.getElementById('domain').value.trim();
            const uuid = document.getElementById('uuid').value.trim();
            const subToken = document.getElementById('subToken').value.trim();
            const customPath = document.getElementById('customPath').value.trim() || '/';
            const maxNodes = document.getElementById('maxNodes').value.trim() || '20';
            
            if (!domain || !uuid) {
                alert('请先填写域名和UUID/Password');
                return;
            }
            
            // 检查至少选择一个协议
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                alert('请至少选择一个协议（VLESS、Trojan或VMess）');
                return;
            }
            
            const ipv4Enabled = document.getElementById('ipv4Enabled').checked;
            const ipv6Enabled = document.getElementById('ipv6Enabled').checked;
            const ispMobile = document.getElementById('ispMobile').checked;
            const ispUnicom = document.getElementById('ispUnicom').checked;
            const ispTelecom = document.getElementById('ispTelecom').checked;
            
            const githubUrl = document.getElementById('githubUrl').value.trim();
            
            const currentUrl = new URL(window.location.href);
            const baseUrl = currentUrl.origin;
            let subscriptionUrl = \`\${baseUrl}/\${uuid}/sub?domain=\${encodeURIComponent(domain)}&epd=\${switches.switchDomain ? 'yes' : 'no'}&epi=\${switches.switchIP ? 'yes' : 'no'}&egi=\${switches.switchGitHub ? 'yes' : 'no'}&top=\${encodeURIComponent(maxNodes)}\`;
            if (switches.switchLA) subscriptionUrl += '&mode=la';
            if (subToken) subscriptionUrl += \`&token=\${encodeURIComponent(subToken)}\`;
            
            // 添加GitHub优选URL
            if (githubUrl) {
                subscriptionUrl += \`&piu=\${encodeURIComponent(githubUrl)}\`;
            }
            
            // 添加协议选择
            if (switches.switchVL) subscriptionUrl += '&ev=yes';
            if (switches.switchTJ) subscriptionUrl += '&et=yes';
            if (switches.switchVM) subscriptionUrl += '&mess=yes';
            
            if (!ipv4Enabled) subscriptionUrl += '&ipv4=no';
            if (!ipv6Enabled) subscriptionUrl += '&ipv6=no';
            if (!ispMobile) subscriptionUrl += '&ispMobile=no';
            if (!ispUnicom) subscriptionUrl += '&ispUnicom=no';
            if (!ispTelecom) subscriptionUrl += '&ispTelecom=no';
            
            // 添加TLS控制（ECH 开启时也会在服务端强制仅 TLS）
            subscriptionUrl += switches.switchTLS ? '&dkby=yes' : '&dkby=no';
            if (switches.switchECH) {
                subscriptionUrl += '&ech=yes';
                const dnsVal = document.getElementById('customDNS') && document.getElementById('customDNS').value.trim();
                if (dnsVal) subscriptionUrl += \`&customDNS=\${encodeURIComponent(dnsVal)}\`;
                const domainVal = document.getElementById('customECHDomain') && document.getElementById('customECHDomain').value.trim();
                if (domainVal) subscriptionUrl += \`&customECHDomain=\${encodeURIComponent(domainVal)}\`;
            }
            
            // 添加自定义路径
            if (customPath && customPath !== '/') {
                subscriptionUrl += \`&path=\${encodeURIComponent(customPath)}\`;
            }
            
            let finalUrl = subscriptionUrl;
            let schemeUrl = '';
            let displayName = clientName || '';
            
            if (clientType === 'v2ray') {
                finalUrl = subscriptionUrl;
                const urlElement = document.getElementById('clientSubscriptionUrl');
                urlElement.textContent = finalUrl;
                urlElement.style.display = 'block';
                
                if (clientName === 'V2RAY') {
                    navigator.clipboard.writeText(finalUrl).then(() => {
                        alert(displayName + ' 订阅链接已复制');
                    });
                } else if (clientName === 'Shadowrocket') {
                    schemeUrl = 'shadowrocket://add/' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            alert(displayName + ' 订阅链接已复制');
                        });
                    });
                } else if (clientName === 'V2RAYNG') {
                    schemeUrl = 'v2rayng://install?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            alert(displayName + ' 订阅链接已复制');
                        });
                    });
                } else if (clientName === 'NEKORAY') {
                    schemeUrl = 'nekoray://install-config?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            alert(displayName + ' 订阅链接已复制');
                        });
                    });
                }
            } else {
                const encodedUrl = encodeURIComponent(subscriptionUrl);
                finalUrl = SUB_CONVERTER_URL + '?target=' + clientType + '&url=' + encodedUrl + '&insert=false&emoji=true&list=false&xudp=false&udp=false&tfo=false&expand=true&scv=false&fdn=false&new_name=true';
                
                const urlElement = document.getElementById('clientSubscriptionUrl');
                urlElement.textContent = finalUrl;
                urlElement.style.display = 'block';
                
                if (clientType === 'clash') {
                    if (clientName === 'STASH') {
                        schemeUrl = 'stash://install?url=' + encodeURIComponent(finalUrl);
                        displayName = 'STASH';
                    } else {
                        schemeUrl = 'clash://install-config?url=' + encodeURIComponent(finalUrl);
                        displayName = 'CLASH';
                    }
                } else if (clientType === 'surge') {
                    schemeUrl = 'surge:///install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'SURGE';
                } else if (clientType === 'sing-box') {
                    schemeUrl = 'sing-box://install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'SING-BOX';
                } else if (clientType === 'loon') {
                    schemeUrl = 'loon://install?url=' + encodeURIComponent(finalUrl);
                    displayName = 'LOON';
                } else if (clientType === 'quanx') {
                    schemeUrl = 'quantumult-x://install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'QUANTUMULT X';
                }
                
                if (schemeUrl) {
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            alert(displayName + ' 订阅链接已复制');
                        });
                    });
                } else {
                    navigator.clipboard.writeText(finalUrl).then(() => {
                        alert(displayName + ' 订阅链接已复制');
                    });
                }
            }
        }
    </script>
</body>
</html>`;
}

// 主处理函数
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        // 主页
        if (path === '/' || path === '') {
            const scuValue = env?.scu || env?.SCU || scu;
            return new Response(generateHomePage(scuValue), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        // 测试优选API API: /test-optimize-api?url=xxx&port=443
        if (path === '/test-optimize-api') {
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    }
                });
            }
            
            const apiUrl = url.searchParams.get('url');
            const port = url.searchParams.get('port') || '443';
            const timeout = parseInt(url.searchParams.get('timeout') || '3000');
            
            if (!apiUrl) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: '缺少url参数' 
                }), {
                    status: 400,
                    headers: { 
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            try {
                const results = await 请求优选API([apiUrl], port, timeout);
                return new Response(JSON.stringify({ 
                    success: true, 
                    results: results,
                    total: results.length,
                    message: `成功获取 ${results.length} 个优选IP`
                }, null, 2), {
                    headers: { 
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } catch (error) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: error.message 
                }), {
                    status: 500,
                    headers: { 
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }
        
        // 订阅请求格式: /{UUID或Password}/sub?domain=xxx&epd=yes&epi=yes&egi=yes
        const pathMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (pathMatch) {
            const uuid = pathMatch[1];
            
            const domain = url.searchParams.get('domain');
            if (!domain) {
                return new Response('缺少域名参数', { status: 400 });
            }
            
            // 订阅Token校验：设置 Worker 环境变量 SUB_TOKEN 或 SUBSCRIBE_TOKEN 后生效
            const requiredToken = env?.SUB_TOKEN || env?.SUBSCRIBE_TOKEN || '';
            if (requiredToken) {
                const providedToken = url.searchParams.get('token') || request.headers.get('x-sub-token') || '';
                if (providedToken !== requiredToken) {
                    return new Response('Forbidden: invalid token', { status: 403 });
                }
            }

            // 从URL参数获取配置，使用局部变量，避免全局变量在并发请求下相互污染
            const epdEnabled = url.searchParams.get('epd') !== 'no';
            const epiEnabled = url.searchParams.get('epi') !== 'no';
            const egiEnabled = url.searchParams.get('egi') !== 'no';
            const piu = url.searchParams.get('piu') || env?.PIU || defaultIPURL;
            const maxNodes = clampNumber(url.searchParams.get('top') || env?.MAX_NODES || DEFAULT_MAX_NODES, 1, MAX_NODES_HARD_LIMIT, DEFAULT_MAX_NODES);
            
            // 协议选择
            const evEnabled = url.searchParams.get('ev') === 'yes' || (url.searchParams.get('ev') === null && ev);
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('mess') === 'yes';
            
            // IPv4/IPv6选择
            const ipv4Enabled = url.searchParams.get('ipv4') !== 'no';
            const ipv6Enabled = url.searchParams.get('ipv6') !== 'no';
            
            // 运营商选择
            const ispMobile = url.searchParams.get('ispMobile') !== 'no';
            const ispUnicom = url.searchParams.get('ispUnicom') !== 'no';
            const ispTelecom = url.searchParams.get('ispTelecom') !== 'no';
            
            // TLS控制：兼容旧订阅链接。
            // 旧链接通常没有 dkby 参数；为避免替换代码后旧链接生成逻辑突变，这里保持旧版默认：不强制仅TLS。
            // 新链接若使用 mode=la，则默认仅TLS；也可通过 dkby=yes/no 显式指定。
            const modeParam = (url.searchParams.get('mode') || '').toLowerCase();
            const dkbyParam = url.searchParams.get('dkby');
            let disableNonTLS = dkbyParam === null ? (modeParam === 'la') : (dkbyParam === 'yes');
            const echParam = url.searchParams.get('ech');
            const echEnabled = echParam === 'yes' || (echParam === null && enableECH);
            if (echEnabled) disableNonTLS = true;
            const customDNSParam = url.searchParams.get('customDNS') || customDNS;
            const customECHDomainParam = url.searchParams.get('customECHDomain') || customECHDomain;
            const echConfig = echEnabled ? `${customECHDomainParam}+${customDNSParam}` : null;

            // 自定义路径
            const customPath = normalizeWsPath(url.searchParams.get('path') || env?.WS_PATH || '/');

            return await handleSubscriptionRequest(
                request，
                uuid,
                domain,
                piu,
                ipv4Enabled,
                ipv6Enabled,
                ispMobile,
                ispUnicom,
                ispTelecom,
                evEnabled,
                etEnabled,
                vmEnabled,
                disableNonTLS,
                customPath,
                echConfig,
                maxNodes,
                { epd: epdEnabled, epi: epiEnabled, egi: egiEnabled }
            );
        }
        
        return new Response('Not Found', { status: 404 });
    }
};
