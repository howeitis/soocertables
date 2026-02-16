// Debug: Check what Juventus goalscorer table returns and why David doesn't match
const https = require('https');
const cheerio = require('cheerio');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 SoccerPoolTracker/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redir = res.headers.location.startsWith('http') ? res.headers.location : `https://en.wikipedia.org${res.headers.location}`;
                res.resume();
                return fetchUrl(redir).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function normalize(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function findTotalColumn(headers) {
    let idx = headers.indexOf('Total');
    if (idx >= 0) return idx;
    idx = headers.findIndex(h => /^Season total$/i.test(h));
    if (idx >= 0) return idx;
    idx = headers.findIndex(h => /^Career club total$/i.test(h));
    return idx;
}

async function main() {
    const html = await fetchUrl('https://en.wikipedia.org/wiki/2025%E2%80%9326_Juventus_FC_season');
    const $ = cheerio.load(html);

    $('table.wikitable').each((i, table) => {
        let headers = [];
        let headerRowIdx = 0;

        $(table).find('tr').first().find('th').each((_, th) => {
            let text = $(th).text().replace(/\.mw-parser-output[\s\S]*?(?=[A-Z])/g, '').replace(/\[.*?\]/g, '').trim();
            headers.push(text);
        });

        if (headers.length <= 2) {
            const row2Headers = [];
            $(table).find('tr').eq(1).find('th').each((_, th) => {
                let text = $(th).text().replace(/\.mw-parser-output[\s\S]*?(?=[A-Z])/g, '').replace(/\[.*?\]/g, '').trim();
                row2Headers.push(text);
            });
            if (row2Headers.length > headers.length) {
                headers = row2Headers;
                headerRowIdx = 1;
            }
        }

        const hasPlayer = headers.some(h => /^(Player|Name)$/i.test(h));
        const hasTotal = findTotalColumn(headers) >= 0;
        const hasRank = headers.some(h => /^(Rank|Rk\.?|#)$/i.test(h));
        const hasGoals = headers.some(h => /^(Goals|Gls)$/i.test(h));

        if (!hasPlayer) return;
        if (!hasTotal && !hasGoals) return;

        console.log(`\nTable ${i}: isGoalscorer=${hasRank}, headerRowIdx=${headerRowIdx}`);
        console.log(`  Headers: ${headers.join(' | ')}`);

        // Parse goalscorer table
        if (hasRank) {
            const playerIdx = headers.findIndex(h => /^(Player|Name)$/i.test(h));
            const totalIdx = findTotalColumn(headers);
            console.log(`  playerIdx=${playerIdx}, totalIdx=${totalIdx}`);

            $(table).find('tr').slice(1 + headerRowIdx).each((_, row) => {
                const cells = $(row).find('th, td');
                if (cells.length < 3) return;

                const offset = Math.max(0, headers.length - cells.length);
                const effPlayerIdx = Math.min(Math.max(0, playerIdx - offset), cells.length - 1);
                const effTotalIdx = Math.min(Math.max(0, totalIdx - offset), cells.length - 1);

                const playerCell = cells.eq(effPlayerIdx);
                let name = playerCell.find('a').first().text().trim() || playerCell.text().trim();
                name = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\*$/, '').trim();
                const goals = parseInt(cells.eq(effTotalIdx).text().replace(/[^0-9]/g, ''), 10);

                if (name && name.length > 2) {
                    console.log(`  "${name}" => ${goals} (cells=${cells.length}, offset=${offset}, effPlayer=${effPlayerIdx}, effTotal=${effTotalIdx})`);
                }
            });
        }
    });

    // Test normalize matching
    const normTarget = normalize('Jonathan David');
    console.log('\nNormalized target: "' + normTarget + '"');

    // What the wiki table returns
    const testNames = ['Kenan Yıldız', 'Jonathan David', 'Dušan Vlahović'];
    for (const name of testNames) {
        const normName = normalize(name);
        const matches = normName.includes(normTarget) || normTarget.includes(normName);
        console.log(`  "${name}" -> "${normName}" matches="${matches}"`);
    }
}

main().catch(err => console.error('Fatal:', err));
