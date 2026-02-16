/**
 * Soccer Pool Tracker — Wikipedia Web Scraper
 * 
 * Scrapes current-season standings and player goals from Wikipedia.
 * Runs via GitHub Actions CRON (daily) or manually.
 * 
 * Run: node scripts/scrape-fbref.js
 * 
 * Architecture:
 *   - Hardcoded Wikipedia URL map (~25 pages)
 *   - Sequential requests with 4s sleep (respectful rate limiting)
 *   - cheerio HTML parsing (no browser needed)
 *   - Data integrity gate before writing results.json
 * 
 * Data Sources:
 *   - League standings: "2025-26 <League>" Wikipedia articles → standings table
 *   - Player goals: Same articles → "Top scorers/goalscorers" table
 *   - UEFA standings: "2025-26 UEFA Champions/Europa/Conference League" articles
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const cheerio = require('cheerio');

const ROSTERS_PATH = path.join(__dirname, '..', 'data', 'rosters.json');
const RESULTS_PATH = path.join(__dirname, '..', 'data', 'results.json');
const REQUEST_DELAY = 4000; // 4 seconds between requests
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoccerPoolTracker/1.0';

// ══════════════════════════════════════════════════════════════════
// HARDCODED WIKIPEDIA URL MAP
// ══════════════════════════════════════════════════════════════════

const LEAGUE_PAGES = [
    { name: 'Premier League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Premier_League' },
    { name: 'La Liga', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_La_Liga' },
    { name: 'Bundesliga', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Bundesliga' },
    { name: 'Serie A', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Serie_A' },
    { name: 'Ligue 1', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Ligue_1' },
    { name: 'Eredivisie', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Eredivisie' },
    { name: 'Primeira Liga', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Primeira_Liga' },
    { name: 'Scottish Premiership', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Scottish_Premiership' },
    { name: 'Süper Lig', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_S%C3%BCper_Lig' },
    { name: 'Belgian Pro League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Belgian_Pro_League' },
    { name: 'Czech First League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Czech_First_League' },
    { name: 'Serbian SuperLiga', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Serbian_SuperLiga' },
    { name: 'Greek Super League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Super_League_Greece' },
];

const UEFA_PAGES = [
    { name: 'Champions League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_UEFA_Champions_League' },
    { name: 'Europa League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_UEFA_Europa_League' },
    { name: 'Conference League', url: 'https://en.wikipedia.org/wiki/2025%E2%80%9326_UEFA_Europa_Conference_League' },
];

// ══════════════════════════════════════════════════════════════════
// NAME MATCHING — Map Wikipedia names to roster names
// ══════════════════════════════════════════════════════════════════

const TEAM_ALIASES = {
    'Manchester City': ['Manchester City', 'Man City'],
    'Atletico Madrid': ['Atlético Madrid', 'Atletico Madrid', 'Atlético de Madrid'],
    'Benfica': ['Benfica', 'SL Benfica', 'S.L. Benfica'],
    'Ajax': ['Ajax', 'AFC Ajax'],
    'Feyenoord': ['Feyenoord'],
    'Fiorentina': ['Fiorentina', 'ACF Fiorentina'],
    'Bayern Munich': ['Bayern Munich', 'Bayern München', 'FC Bayern Munich'],
    'Liverpool': ['Liverpool'],
    'Borussia Dortmund': ['Borussia Dortmund', 'Dortmund'],
    'Sporting CP': ['Sporting CP', 'Sporting'],
    'Atalanta': ['Atalanta', 'Atalanta BC'],
    'Lyon': ['Lyon', 'Olympique Lyonnais'],
    'Arsenal': ['Arsenal'],
    'Chelsea': ['Chelsea'],
    'Celtic': ['Celtic'],
    'Fenerbahce': ['Fenerbahçe', 'Fenerbahce'],
    'Slavia Praha': ['Slavia Prague', 'Slavia Praha', 'SK Slavia Prague'],
    'AS Monaco': ['Monaco', 'AS Monaco'],
    'Real Madrid': ['Real Madrid'],
    'Inter Milan': ['Inter Milan', 'Internazionale', 'Inter', 'FC Internazionale Milano'],
    'Red Star Belgrade': ['Red Star Belgrade', 'Crvena Zvezda', 'Red Star'],
    'Olympiacos': ['Olympiacos', 'Olympiakos', 'Olympiacos F.C.'],
    'Sparta Praha': ['Sparta Prague', 'Sparta Praha', 'AC Sparta Prague'],
    'Union SG': ['Union SG', 'Royale Union Saint-Gilloise', 'Union Saint-Gilloise', 'Union St.-Gilloise', 'R. Union SG'],
    'PSG': ['Paris Saint-Germain', 'PSG', 'Paris S-G'],
    'Napoli': ['Napoli', 'S.S.C. Napoli', 'SSC Napoli'],
    'FC Porto': ['Porto', 'FC Porto'],
    'Bayer Leverkusen': ['Bayer Leverkusen', 'Bayer 04 Leverkusen', 'Leverkusen'],
    'Rangers': ['Rangers', 'Rangers F.C.'],
    'Ipswich Town': ['Ipswich Town', 'Ipswich'],
    'Barcelona': ['Barcelona', 'FC Barcelona'],
    'Galatasaray': ['Galatasaray'],
    'PSV Eindhoven': ['PSV Eindhoven', 'PSV'],
    'Aston Villa': ['Aston Villa'],
    'AS Roma': ['Roma', 'AS Roma', 'A.S. Roma'],
    'Strasbourg': ['Strasbourg', 'RC Strasbourg Alsace', 'RC Strasbourg'],
};

const PLAYER_ALIASES = {
    'Kylian Mbappe': ['Kylian Mbappé', 'Mbappé'],
    'Alexander Isak': ['Alexander Isak'],
    'Serhou Guirassy': ['Serhou Guirassy'],
    'Jhon Duran': ['Jhon Durán', 'Jhon Duran'],
    'Rasmus Højlund': ['Rasmus Højlund'],
    'Mika Biereth': ['Mika Biereth'],
    'Erling Haaland': ['Erling Haaland'],
    'Bukayo Saka': ['Bukayo Saka'],
    'Bradley Barcola': ['Bradley Barcola'],
    'Julian Alvarez': ['Julián Álvarez', 'Julian Álvarez'],
    'Jonathan David': ['Jonathan David'],
    'Victor Aghehowa': ['Victor Aghehowa'],
    'Viktor Gyökeres': ['Viktor Gyökeres'],
    'Raphinha': ['Raphinha'],
    'Lamine Yamal': ['Lamine Yamal'],
    'Michael Olise': ['Michael Olise'],
    'Cody Gakpo': ['Cody Gakpo'],
    'Desire Doue': ['Désiré Doué', 'Desiré Doué'],
    'Robert Lewandowski': ['Robert Lewandowski'],
    'Ousmane Dembele': ['Ousmane Dembélé'],
    'Vangelis Pavlidis': ['Vangelis Pavlidis', 'Evangelos Pavlidis'],
    'Alexander Sorloth': ['Alexander Sørloth'],
    'Moise Kean': ['Moise Kean'],
    'Ollie Watkins': ['Ollie Watkins'],
    'Mohamed Salah': ['Mohamed Salah'],
    'Victor Osimhen': ['Victor Osimhen'],
    'Vinícius Júnior': ['Vinícius Júnior', 'Vinicius Junior', 'Vinícius Jr.'],
    'Cole Palmer': ['Cole Palmer'],
    'Lois Openda': ['Loïs Openda', 'Lois Openda'],
    'Dusan Vlahovic': ['Dušan Vlahović', 'Dusan Vlahovic'],
    'Harry Kane': ['Harry Kane'],
    'Lautaro Martinez': ['Lautaro Martínez'],
    'Omar Marmoush': ['Omar Marmoush'],
    'Hugo Ekitike': ['Hugo Ekitike'],
    'Alassane Plea': ['Alassane Pléa'],
    'Emanuel Emegha': ['Emanuel Emegha'],
};

// Player → Club season page URL (for getting individual player goals)
// Only need pages for clubs that have our roster players
const PLAYER_TEAM_MAP = {
    'Kylian Mbappe': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Real_Madrid_CF_season',
    'Alexander Isak': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Liverpool_F.C._season', // transferred from Newcastle Jan 2026
    'Serhou Guirassy': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Borussia_Dortmund_season',
    // Jhon Duran: excluded per user request (transferred to Al Ahli, no wiki page)
    'Rasmus Højlund': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_SSC_Napoli_season', // loan from Man United
    'Mika Biereth': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_AS_Monaco_FC_season',
    'Erling Haaland': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Manchester_City_F.C._season',
    'Bukayo Saka': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Arsenal_F.C._season',
    'Bradley Barcola': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Paris_Saint-Germain_FC_season',
    'Julian Alvarez': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Atl%C3%A9tico_Madrid_season',
    'Jonathan David': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Juventus_FC_season', // transferred from Lille summer 2025
    // Victor Aghehowa: no Wikipedia page found
    'Viktor Gyökeres': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Arsenal_F.C._season', // transferred from Sporting CP Jul 2025
    'Raphinha': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_FC_Barcelona_season',
    'Lamine Yamal': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_FC_Barcelona_season',
    'Michael Olise': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_FC_Bayern_Munich_season',
    'Cody Gakpo': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Liverpool_F.C._season',
    'Desire Doue': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Paris_Saint-Germain_FC_season',
    'Robert Lewandowski': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_FC_Barcelona_season',
    'Ousmane Dembele': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Paris_Saint-Germain_FC_season',
    'Vangelis Pavlidis': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_SL_Benfica_season',
    'Alexander Sorloth': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Atl%C3%A9tico_Madrid_season',
    'Moise Kean': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_ACF_Fiorentina_season',
    'Ollie Watkins': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Aston_Villa_F.C._season',
    'Mohamed Salah': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Liverpool_F.C._season',
    'Victor Osimhen': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Galatasaray_S.K._season',
    'Vinícius Júnior': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Real_Madrid_CF_season',
    'Cole Palmer': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Chelsea_F.C._season',
    'Lois Openda': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_RB_Leipzig_season',
    'Dusan Vlahovic': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Juventus_FC_season',
    'Harry Kane': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_FC_Bayern_Munich_season',
    'Lautaro Martinez': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Inter_Milan_season',
    'Omar Marmoush': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Manchester_City_F.C._season',
    'Hugo Ekitike': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_Liverpool_F.C._season',
    'Alassane Plea': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_PSV_Eindhoven_season', // transferred from Mönchengladbach
    'Emanuel Emegha': 'https://en.wikipedia.org/wiki/2025%E2%80%9326_RC_Strasbourg_Alsace_season',
};

// ══════════════════════════════════════════════════════════════════
// HTTP FETCHING
// ══════════════════════════════════════════════════════════════════

let requestCount = 0;

function fetchPage(url) {
    return new Promise((resolve, reject) => {
        requestCount++;
        console.log(`   [${requestCount}] GET ${url.split('/wiki/')[1] || url}`);

        https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirect = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `https://en.wikipedia.org${res.headers.location}`;
                console.log(`   ↳ Redirect → ${redirect.split('/wiki/')[1] || redirect}`);
                res.resume();
                return fetchPage(redirect).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════════
// NAME MATCHING
// ══════════════════════════════════════════════════════════════════

function normalize(str) {
    return (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchTeamName(wikiName) {
    // Clean up wiki artifacts
    const cleaned = wikiName
        .replace(/\.mw-parser-output[\s\S]*?(?=[A-Z])/g, '')
        .replace(/\([a-z]\)$/i, '')
        .trim();

    const wikiNorm = normalize(cleaned);
    for (const [rosterName, aliases] of Object.entries(TEAM_ALIASES)) {
        for (const alias of aliases) {
            if (normalize(alias) === wikiNorm) return rosterName;
        }
        if (normalize(rosterName) === wikiNorm) return rosterName;
    }
    // Partial match — check if wiki name starts with or contains roster alias
    for (const [rosterName, aliases] of Object.entries(TEAM_ALIASES)) {
        for (const alias of aliases) {
            const aN = normalize(alias);
            if (aN.length > 4 && (wikiNorm.startsWith(aN) || wikiNorm.includes(aN))) {
                return rosterName;
            }
        }
    }
    return null;
}

function matchPlayerName(wikiName) {
    const wikiNorm = normalize(wikiName);
    for (const [rosterName, aliases] of Object.entries(PLAYER_ALIASES)) {
        for (const alias of aliases) {
            if (normalize(alias) === wikiNorm) return rosterName;
        }
        if (normalize(rosterName) === wikiNorm) return rosterName;
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════
// HTML PARSERS
// ══════════════════════════════════════════════════════════════════

/**
 * Parse league standings table from Wikipedia.
 * Looks for tables with 'Pts' column header.
 * Returns: { teamName: points }
 */
function parseStandings(html) {
    const $ = cheerio.load(html);
    const standings = {};

    $('table.wikitable').each((_, table) => {
        const $table = $(table);
        const headers = [];
        $table.find('tr').first().find('th').each((__, th) => {
            headers.push($(th).text().trim());
        });

        if (!headers.includes('Pts')) return;

        // Find Team and Pts column indices
        let teamIdx = headers.indexOf('Team');
        if (teamIdx === -1) teamIdx = 1; // fallback to second column
        const ptsIdx = headers.indexOf('Pts');

        $table.find('tbody tr, tr').slice(1).each((__, row) => {
            const $row = $(row);
            if ($row.find('th').length > 2) return; // skip header rows

            const cells = $row.find('th, td');
            const teamCell = cells.eq(teamIdx);
            const ptsCell = cells.eq(ptsIdx);

            // Get team name — look for link text first, then plain text
            let teamName = teamCell.find('a').last().text().trim() || teamCell.text().trim();
            // Clean up Wikipedia formatting artifacts
            teamName = teamName.replace(/\(.\)$/, '').replace(/\[.*?\]/g, '').trim();

            const ptsText = ptsCell.text().replace(/[^0-9]/g, '').trim();
            const pts = parseInt(ptsText, 10);

            if (teamName && !isNaN(pts)) {
                standings[teamName] = pts;
            }
        });

        // If we found data, stop looking at more tables
        if (Object.keys(standings).length > 5) return false;
    });

    return standings;
}

/**
 * Parse top scorers table from Wikipedia.
 * Looks for tables near "Top scorers" or "Top goalscorers" headings.
 * Returns: { playerName: goals }
 */
function parseTopScorers(html) {
    const $ = cheerio.load(html);
    const scorers = {};

    // Strategy: find tables with Player/Goals columns
    $('table.wikitable').each((_, table) => {
        const $table = $(table);
        const headers = [];
        $table.find('tr').first().find('th').each((__, th) => {
            // Clean header — remove footnote references
            const text = $(th).text().replace(/\[.*?\]/g, '').trim();
            headers.push(text);
        });

        // Check for scorer table markers
        const hasPlayer = headers.some(h => h === 'Player' || h === 'Name');
        const hasGoals = headers.some(h => h === 'Goals' || h === 'Gls' || h.startsWith('Goals'));
        const hasRank = headers.some(h => h === 'Rank' || h === '#' || h === 'Pos');

        if (!hasPlayer || !hasGoals) return;

        const playerIdx = headers.findIndex(h => h === 'Player' || h === 'Name');
        const goalsIdx = headers.findIndex(h => h === 'Goals' || h === 'Gls' || h.startsWith('Goals'));

        let lastGoals = 0; // for handling rowspan (tied ranks share goals value)

        $table.find('tr').slice(1).each((__, row) => {
            const $row = $(row);
            const cells = $row.find('th, td');

            // Handle rowspan: when a player has the same rank as above, 
            // the goals cell might be in a different position
            let playerName = '';
            let goals = NaN;

            cells.each((ci, cell) => {
                const $cell = $(cell);
                const dataStat = $cell.attr('data-stat');
                const text = $cell.text().trim();

                // Try to identify player and goals by position
                if (ci === playerIdx || (ci === playerIdx - 1 && cells.length < headers.length)) {
                    playerName = $cell.find('a').first().text().trim() || text;
                }
            });

            // Get goals — try the expected column position
            const goalsCell = cells.eq(goalsIdx < cells.length ? goalsIdx : cells.length - 1);
            const goalsText = goalsCell.text().replace(/[^0-9]/g, '').trim();
            goals = parseInt(goalsText, 10);

            // If no goals found (rowspan), use last known goals value
            if (isNaN(goals) && playerName) {
                goals = lastGoals;
            }
            if (!isNaN(goals)) {
                lastGoals = goals;
            }

            // If player name is empty, try the second cell
            if (!playerName) {
                const fallback = cells.eq(1);
                playerName = fallback.find('a').first().text().trim() || fallback.text().trim();
            }

            if (playerName && !isNaN(goals) && goals > 0) {
                // Some players might appear in multiple competitions — sum their goals
                scorers[playerName] = (scorers[playerName] || 0) + goals;
            }
        });

        // If we found scorers, done (take the first matching table)
        if (Object.keys(scorers).length > 0) return false;
    });

    return scorers;
}

/**
 * Parse goalscorers from a team season page on Wikipedia.
 * 
 * Two fundamentally different table types exist:
 *   TYPE A — Dedicated goalscorer table (has Rank/Rk. column):
 *     Rank | No. | Pos. | Player | League | Cup | ... | Total
 *     Here "Total" = total GOALS. Use the Total column directly.
 *   
 *   TYPE B — Squad appearances table (no Rank column):
 *     No. | Pos | Nat | Player | Total | League(Apps|Goals) | Cup(Apps|Goals) | ...
 *     Here "Total" = total APPEARANCES. Goals are embedded per-competition.
 *     We must sum the Goals sub-columns for each competition.
 *
 * Returns: { playerName: totalGoals }
 */
function parseTeamGoalscorers(html, targetPlayerNames) {
    const $ = cheerio.load(html);
    const scorers = {};
    const normTargets = (targetPlayerNames || []).map(n => normalize(n));

    // Helper: check if a table row contains sub-headers with Apps|Goals pattern
    function detectAppsGoalsPattern($table) {
        // Check second row for Apps/Goals sub-headers
        const secondRow = $table.find('tr').eq(1);
        const subText = secondRow.text().toLowerCase();
        return subText.includes('apps') && subText.includes('goals');
    }

    // Helper: find the "Total" column index (supports aliases)
    function findTotalColumn(headers) {
        let idx = headers.indexOf('Total');
        if (idx >= 0) return idx;
        idx = headers.findIndex(h => /^Season total$/i.test(h));
        if (idx >= 0) return idx;
        idx = headers.findIndex(h => /^Career club total$/i.test(h));
        return idx; // returns -1 if not found
    }

    // Helper: parse a dedicated goalscorer table (Type A)
    function parseGoalscorerTable($table, headers, headerRowIdx) {
        headerRowIdx = headerRowIdx || 0;
        const result = {};
        const playerIdx = headers.findIndex(h => /^(Player|Name)$/i.test(h));
        const totalIdx = findTotalColumn(headers);
        if (playerIdx < 0 || totalIdx < 0) return result;

        // Detect if this table has 2x cell inflation (sub-columns)
        // This happens when competition headers span 2 sub-cells (Apps|Goals)
        const firstDataRow = $table.find('tr').eq(1 + headerRowIdx);
        const firstDataCells = firstDataRow.find('th, td').length;
        const cellMultiplier = firstDataCells > headers.length * 1.5 ? 2 : 1;

        $table.find('tr').slice(1 + headerRowIdx).each((__, row) => {
            const cells = $(row).find('th, td');
            if (cells.length < 3) return;

            const firstText = cells.first().text().trim();
            if (['Total', 'Totals'].includes(firstText)) return;

            // Handle rowspan offsets AND cell multiplier
            const offset = Math.max(0, headers.length - cells.length);
            let effPlayerIdx, effTotalIdx;

            if (cellMultiplier > 1 && cells.length > headers.length) {
                // 2x cell inflation: info columns (before competitions) are 1:1,
                // competition columns are 2:1 (apps+goals)
                const infoCols = playerIdx + 1; // columns before and including Player
                effPlayerIdx = playerIdx;
                // After info cols, each header becomes 2 cells
                effTotalIdx = infoCols + (totalIdx - infoCols) * 2;
            } else {
                effPlayerIdx = Math.min(Math.max(0, playerIdx - offset), cells.length - 1);
                effTotalIdx = Math.min(Math.max(0, totalIdx - offset), cells.length - 1);
            }

            const playerCell = cells.eq(effPlayerIdx);
            let name = playerCell.find('a').first().text().trim() || playerCell.text().trim();
            name = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\*$/, '').trim();
            if (!name || name.length < 2) return;

            const goals = parseInt(cells.eq(effTotalIdx).text().replace(/[^0-9]/g, ''), 10);
            if (!isNaN(goals) && goals > 0) {
                result[name] = goals;
            }
        });
        return result;
    }

    // Helper: parse a squad appearances table (Type B)
    // In these tables, each competition has two sub-columns: Apps | Goals
    // The "Total" header spans two sub-columns too: total Apps | total Goals
    function parseSquadAppearancesTable($table, headers, headerRowIdx) {
        headerRowIdx = headerRowIdx || 0;
        const result = {};
        const playerIdx = headers.findIndex(h => /^(Player|Name)$/i.test(h));
        if (playerIdx < 0) return result;

        // Detect if this has Apps|Goals sub-rows by checking second row
        const hasSubHeaders = detectAppsGoalsPattern($table);
        if (!hasSubHeaders) {
            // No Apps|Goals sub-headers — probably not a squad table
            return result;
        }

        // The data rows start at index 2 + headerRowIdx offset
        $table.find('tr').slice(2 + headerRowIdx).each((__, row) => {
            const cells = $(row).find('th, td');
            if (cells.length < 5) return;

            const firstText = cells.first().text().trim();
            if (['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Total', 'Totals'].includes(firstText)) return;

            // Player cell is at the expected position
            const playerCell = cells.eq(Math.min(playerIdx, cells.length - 1));
            let name = playerCell.find('a').first().text().trim() || playerCell.text().trim();
            name = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\*$/, '').trim();
            if (!name || name.length < 2) return;

            // Goals are in every other column after the player + info columns
            // Pattern: No | Pos | Nat | Player | Total(Apps) | Total(Goals) | League(Apps) | League(Goals) | ...
            // OR:      No | Pos | Nat | Player | League(Apps) | League(Goals) | Cup(Apps) | Cup(Goals) | ... | Total(Apps) | Total(Goals)
            // We need to find the "Total" goals sub-column

            // Strategy: sum ALL even-indexed cells after the player metadata columns
            // (every other cell is a Goals column)
            // Better strategy: find the total by checking header positions

            // The Total header index tells us where total apps are. Total goals is at position totalIdx + 1 equivalent
            const totalHeaderIdx = findTotalColumn(headers);
            if (totalHeaderIdx >= 0) {
                // In the sub-row layout, each header becomes 2 cells
                // Cells before player metadata: the info columns (No, Pos, Nat) each take 1 cell
                // After player: each competition header becomes 2 cells (Apps|Goals) 
                // Count info columns (before and including Player)
                const infoCols = playerIdx + 1; // e.g. No(0), Pos(1), Nat(2), Player(3) = 4 info cols
                // Count competition columns after player
                const compIdx = totalHeaderIdx - infoCols; // index among competition headers
                // In data row, data starts after infoCols
                // Each competition occupies 2 cells (apps, goals)
                const totalAppsCell = infoCols + (compIdx * 2);
                const totalGoalsCell = totalAppsCell + 1;

                if (totalGoalsCell < cells.length) {
                    const goals = parseInt(cells.eq(totalGoalsCell).text().replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(goals) && goals > 0) {
                        result[name] = goals;
                        return;
                    }
                }
            }

            // Fallback: sum the goals from each competition
            // Goals are in odd-indexed cells after info columns (Apps=even, Goals=odd)
            let totalGoals = 0;
            const infoCols2 = playerIdx + 1;
            for (let ci = infoCols2 + 1; ci < cells.length; ci += 2) {
                const g = parseInt(cells.eq(ci).text().replace(/[^0-9]/g, ''), 10);
                if (!isNaN(g)) totalGoals += g;
            }
            if (totalGoals > 0) {
                result[name] = totalGoals;
            }
        });
        return result;
    }

    // Collect all candidate tables
    const candidates = [];
    $('table.wikitable').each((tableIdx, table) => {
        const $table = $(table);
        let headers = [];
        let headerRowIdx = 0; // track which row has the real headers

        $table.find('tr').first().find('th').each((__, th) => {
            let text = $(th).text()
                .replace(/\.mw-parser-output[\s\S]*?(?=[A-Z])/g, '')
                .replace(/\[.*?\]/g, '')
                .trim();
            headers.push(text);
        });

        // Detect title rows: if first row has only 1-2 headers (spanning title),
        // the real column headers are in the SECOND row
        if (headers.length <= 2) {
            const row2Headers = [];
            $table.find('tr').eq(1).find('th').each((__, th) => {
                let text = $(th).text()
                    .replace(/\.mw-parser-output[\s\S]*?(?=[A-Z])/g, '')
                    .replace(/\[.*?\]/g, '')
                    .trim();
                row2Headers.push(text);
            });
            if (row2Headers.length > headers.length) {
                headers = row2Headers;
                headerRowIdx = 1;
            }
        }

        const hasPlayer = headers.some(h => /^(Player|Name)$/i.test(h));
        const hasTotal = findTotalColumn(headers) >= 0;
        // Support Rk., Rank, #
        const hasRank = headers.some(h => /^(Rank|Rk\.?|#)$/i.test(h));
        const hasGoals = headers.some(h => /^(Goals|Gls)$/i.test(h));
        const hasPos = headers.some(h => /^Pos\.?$/i.test(h));

        if (!hasPlayer) return; // must have Player/Name column
        if (!hasTotal && !hasGoals) return; // must have Total or Goals column

        // Determine table type
        const isGoalscorerTable = hasRank; // Rank column → dedicated goalscorer table
        const priority = isGoalscorerTable ? 10 : (hasPos ? 5 : 1);

        candidates.push({ $table, headers, tableIdx, priority, isGoalscorerTable, hasTotal, hasGoals, headerRowIdx });
    });

    // Sort: goalscorer tables first
    candidates.sort((a, b) => b.priority - a.priority);

    for (const { $table, headers, isGoalscorerTable, headerRowIdx } of candidates) {
        let tableScorers;

        if (isGoalscorerTable) {
            tableScorers = parseGoalscorerTable($table, headers, headerRowIdx);
        } else {
            // Try as squad appearances table first, then as simple table
            tableScorers = parseSquadAppearancesTable($table, headers, headerRowIdx);
            if (Object.keys(tableScorers).length === 0) {
                // Fallback: treat as goalscorer table (use Total directly)
                tableScorers = parseGoalscorerTable($table, headers, headerRowIdx);
            }
        }

        if (Object.keys(tableScorers).length === 0) continue;

        // Merge new scorers (don't overwrite existing — first found wins)
        for (const [name, goals] of Object.entries(tableScorers)) {
            if (!(name in scorers)) {
                scorers[name] = goals;
            }
        }

        // Check if we've found all target players
        if (normTargets.length > 0) {
            const foundTargets = normTargets.filter(t => {
                return Object.keys(scorers).some(wikiName => {
                    const normWiki = normalize(wikiName);
                    return normWiki.includes(t) || t.includes(normWiki);
                });
            });
            if (foundTargets.length === normTargets.length) break; // all found
        }
    }

    return scorers;
}

// ══════════════════════════════════════════════════════════════════
// DATA INTEGRITY GATE
// ══════════════════════════════════════════════════════════════════

function validateResults(newResults, previousResults) {
    const errors = [];

    // Rule B: Check for null, NaN, negative
    for (const entry of newResults.team_pool || []) {
        if (entry.total_points == null || isNaN(entry.total_points) || entry.total_points < 0) {
            errors.push(`Rule B: ${entry.participant} team points invalid (${entry.total_points})`);
        }
    }
    for (const entry of newResults.goals_pool || []) {
        if (entry.total_goals == null || isNaN(entry.total_goals) || entry.total_goals < 0) {
            errors.push(`Rule B: ${entry.participant} goals invalid (${entry.total_goals})`);
        }
    }

    // Rule A: No participant's total can drop below previous cache
    if (previousResults && previousResults.team_pool) {
        for (const prev of previousResults.team_pool) {
            const curr = (newResults.team_pool || []).find(e => e.participant === prev.participant);
            if (curr && curr.total_points < prev.total_points) {
                errors.push(`Rule A: ${prev.participant} team points dropped ${prev.total_points} → ${curr.total_points}`);
            }
        }
    }
    if (previousResults && previousResults.goals_pool) {
        for (const prev of previousResults.goals_pool) {
            const curr = (newResults.goals_pool || []).find(e => e.participant === prev.participant);
            if (curr && curr.total_goals < prev.total_goals) {
                errors.push(`Rule A: ${prev.participant} goals dropped ${prev.total_goals} → ${curr.total_goals}`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

// ══════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════

async function main() {
    console.log('🔄 Soccer Pool Tracker — Wikipedia Scraper');
    console.log(`   Time: ${new Date().toISOString()}\n`);

    const rosters = JSON.parse(fs.readFileSync(ROSTERS_PATH, 'utf8'));

    // Load previous results for integrity gate
    let previousResults = null;
    try {
        previousResults = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
    } catch (e) {
        console.log('   ⚠️  No previous results.json (first run)\n');
    }

    // Collect roster names
    const rosterTeams = new Set();
    const rosterPlayers = new Set();
    for (const roster of rosters.rosters) {
        for (const team of roster.teams) rosterTeams.add(team.name);
        for (const player of roster.players) rosterPlayers.add(player.name);
    }

    const teamPoints = {};     // rosterName → league points
    const uefaPoints = {};     // rosterName → UEFA phase points
    const playerGoals = {};    // rosterName → total goals (summed across comps)

    // ── Phase 1: Scrape domestic leagues ──
    console.log('📊 Scraping domestic league standings & top scorers...');
    for (const league of LEAGUE_PAGES) {
        try {
            const html = await fetchPage(league.url);

            // Parse standings
            const standings = parseStandings(html);
            const teamCount = Object.keys(standings).length;

            let matched = 0;
            for (const [wikiName, pts] of Object.entries(standings)) {
                const rosterName = matchTeamName(wikiName);
                if (rosterName && rosterTeams.has(rosterName)) {
                    teamPoints[rosterName] = pts;
                    matched++;
                    console.log(`      ✅ ${rosterName}: ${pts} pts`);
                }
            }

            // Parse top scorers
            const scorers = parseTopScorers(html);
            let scorerMatched = 0;
            for (const [wikiName, goals] of Object.entries(scorers)) {
                const rosterName = matchPlayerName(wikiName);
                if (rosterName && rosterPlayers.has(rosterName)) {
                    playerGoals[rosterName] = (playerGoals[rosterName] || 0) + goals;
                    scorerMatched++;
                    console.log(`      ⚽ ${rosterName}: ${goals} goals`);
                }
            }

            console.log(`   ✅ ${league.name}: ${teamCount} teams (${matched} matched), ${Object.keys(scorers).length} scorers (${scorerMatched} matched)`);
        } catch (err) {
            console.log(`   ❌ ${league.name}: ${err.message}`);
        }
        await sleep(REQUEST_DELAY);
    }

    // ── Phase 2: Scrape UEFA competitions ──
    console.log('\n🏆 Scraping UEFA competition standings & scorers...');
    for (const comp of UEFA_PAGES) {
        try {
            const html = await fetchPage(comp.url);

            // Parse UEFA standings (league phase points)
            const standings = parseStandings(html);
            let matched = 0;
            for (const [wikiName, pts] of Object.entries(standings)) {
                const rosterName = matchTeamName(wikiName);
                if (rosterName && rosterTeams.has(rosterName)) {
                    uefaPoints[rosterName] = (uefaPoints[rosterName] || 0) + pts;
                    matched++;
                    console.log(`      ✅ ${rosterName}: ${pts} UEFA pts`);
                }
            }

            // Parse UEFA top scorers
            const scorers = parseTopScorers(html);
            let scorerMatched = 0;
            for (const [wikiName, goals] of Object.entries(scorers)) {
                const rosterName = matchPlayerName(wikiName);
                if (rosterName && rosterPlayers.has(rosterName)) {
                    playerGoals[rosterName] = (playerGoals[rosterName] || 0) + goals;
                    scorerMatched++;
                    console.log(`      ⚽ ${rosterName}: +${goals} UEFA goals`);
                }
            }

            console.log(`   ✅ ${comp.name}: ${Object.keys(standings).length} teams (${matched} matched), ${Object.keys(scorers).length} scorers (${scorerMatched} matched)`);
        } catch (err) {
            console.log(`   ❌ ${comp.name}: ${err.message}`);
        }
        await sleep(REQUEST_DELAY);
    }

    // ── Phase 2.5: Scrape team season pages for missing player goals ──
    const missingPlayersPhase25 = [...rosterPlayers].filter(p => !(p in playerGoals));
    if (missingPlayersPhase25.length > 0) {
        console.log(`\n👤 Scraping team season pages for ${missingPlayersPhase25.length} missing players...`);

        // Deduplicate URLs — multiple players may share a club page
        const urlToPlayers = {};
        for (const playerName of missingPlayersPhase25) {
            const url = PLAYER_TEAM_MAP[playerName];
            if (!url) {
                console.log(`   ⚠️  No team page URL for ${playerName}`);
                continue;
            }
            if (!urlToPlayers[url]) urlToPlayers[url] = [];
            urlToPlayers[url].push(playerName);
        }

        for (const [url, players] of Object.entries(urlToPlayers)) {
            try {
                const html = await fetchPage(url);
                const teamScorers = parseTeamGoalscorers(html, players);
                const scorerCount = Object.keys(teamScorers).length;

                for (const playerName of players) {
                    // Try to match this player in the team's goalscorer table
                    let found = false;
                    for (const [wikiName, goals] of Object.entries(teamScorers)) {
                        const matched = matchPlayerName(wikiName);
                        if (matched === playerName) {
                            playerGoals[playerName] = goals;
                            found = true;
                            console.log(`      ⚽ ${playerName}: ${goals} goals (team page)`);
                            break;
                        }
                    }
                    if (!found) {
                        console.log(`      ⚠️  ${playerName}: not in team scorers (${scorerCount} listed)`);
                    }
                }
            } catch (err) {
                console.log(`   ❌ ${url.split('/wiki/')[1]}: ${err.message}`);
                for (const p of players) {
                    console.log(`      ⚠️  ${p}: skipped (page error)`);
                }
            }
            await sleep(REQUEST_DELAY);
        }
    }

    // ── Phase 3: Compute results ──
    console.log('\n📋 Computing results...');
    const teamPool = [];
    const goalsPool = [];

    for (const roster of rosters.rosters) {
        let teamTotal = 0;
        const teamBreakdowns = [];

        for (const team of roster.teams) {
            const league = teamPoints[team.name] || 0;
            const uefa = uefaPoints[team.name] || 0;
            const total = league + uefa;
            teamTotal += total;

            teamBreakdowns.push({
                name: team.name,
                league_points: league,
                uefa_points: uefa,
                domestic_cup_points: 0,
                details: `League: ${league}` + (uefa > 0 ? ` | UEFA: ${uefa}` : ''),
            });
        }

        teamPool.push({
            participant: roster.participant,
            total_points: teamTotal,
            rank: 0,
            teams: teamBreakdowns,
        });

        let goalsTotal = 0;
        const playerBreakdowns = [];

        for (const player of roster.players) {
            const goals = playerGoals[player.name] || 0;
            goalsTotal += goals;
            playerBreakdowns.push({ name: player.name, goals });
        }

        goalsPool.push({
            participant: roster.participant,
            total_goals: goalsTotal,
            rank: 0,
            players: playerBreakdowns,
        });
    }

    // Assign ranks
    teamPool.sort((a, b) => b.total_points - a.total_points);
    teamPool.forEach((e, i) => { e.rank = i + 1; });
    goalsPool.sort((a, b) => b.total_goals - a.total_goals);
    goalsPool.forEach((e, i) => { e.rank = i + 1; });

    const results = {
        last_updated: new Date().toISOString(),
        season: rosters.pool_metadata.season,
        team_pool: teamPool,
        goals_pool: goalsPool,
    };

    // ── Phase 4: Data Integrity Gate ──
    console.log('\n🔒 Data Integrity Gate...');
    const validation = validateResults(results, previousResults);

    if (!validation.valid) {
        console.log('   ❌ INTEGRITY CHECK FAILED:');
        validation.errors.forEach(e => console.log(`      • ${e}`));
        console.log('\n   ⚠️  Aborting. Existing results.json preserved.');
        process.exit(1);
    }
    console.log('   ✅ All checks passed');

    // ── Phase 5: Write results ──
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results written to ${RESULTS_PATH}`);
    console.log(`   Total requests: ${requestCount}`);

    // Summary
    console.log('\n=== TEAM POOL ===');
    teamPool.forEach(t => console.log(`   ${t.rank}. ${t.participant}: ${t.total_points} pts`));
    console.log('\n=== GOALS POOL ===');
    goalsPool.forEach(g => console.log(`   ${g.rank}. ${g.participant}: ${g.total_goals} goals`));

    // Missing data warnings
    const missingTeams = [...rosterTeams].filter(t => !(t in teamPoints) && !(t in uefaPoints));
    const missingPlayers = [...rosterPlayers].filter(p => !(p in playerGoals));
    if (missingTeams.length > 0) console.log(`\n⚠️  Missing teams (0 pts): ${missingTeams.join(', ')}`);
    if (missingPlayers.length > 0) console.log(`⚠️  Missing players (0 goals): ${missingPlayers.join(', ')}`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
