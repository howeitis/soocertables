/**
 * Soccer Pool Tracker — View Renderers
 * Renders Team Pool, Goals Pool, and Winningz views into the DOM.
 */

const Views = (() => {

    /**
     * Renders the Team Pool view.
     * @param {Array} teamPool - Sorted array of participant team standings
     * @returns {string} HTML string
     */
    function renderTeamPool(teamPool) {
        if (!teamPool || teamPool.length === 0) {
            return '<div class="error-state">No team pool data available.</div>';
        }

        let html = `
      <div class="pool-summary">
        <span class="pool-label">Team Points Pool</span>
        <span class="pool-amount">$300</span>
      </div>
      <div class="standings-list">
    `;

        teamPool.forEach((entry, idx) => {
            const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
            const badgeClass = entry.rank > 3 ? 'rank-other' : '';

            html += `
        <div class="standing-row ${rankClass}" data-idx="${idx}">
          <div class="standing-main" onclick="App.toggleAccordion(this)">
            <div class="rank-badge ${badgeClass}">${entry.rank}</div>
            <div class="participant-name">${escapeHtml(entry.participant)}</div>
            <div>
              <div class="stat-value">${entry.total_points}</div>
              <div class="stat-label">Points</div>
            </div>
            <span class="expand-icon">▼</span>
          </div>
          <div class="breakdown">
            <div class="breakdown-inner">
              ${renderTeamBreakdown(entry.teams)}
            </div>
          </div>
        </div>
      `;
        });

        html += '</div>';
        return html;
    }

    /**
     * Renders team breakdown accordion content.
     * @param {Array} teams
     * @returns {string} HTML string
     */
    function renderTeamBreakdown(teams) {
        if (!teams || teams.length === 0) return '<div class="breakdown-item">No teams</div>';

        return teams.map(team => {
            const total = (team.league_points || 0) + (team.uefa_points || 0) + (team.domestic_cup_points || 0);

            return `
        <div class="breakdown-item team-item">
          <div>
            <div class="breakdown-name">${escapeHtml(team.name)}</div>
            ${team.details ? `<div class="breakdown-detail">${escapeHtml(team.details)}</div>` : ''}
          </div>
          <span class="breakdown-pts pts-league" title="League Points">${team.league_points || 0} LG</span>
          ${team.uefa_points ? `<span class="breakdown-pts pts-uefa" title="UEFA Points">${team.uefa_points} UE</span>` : '<span class="breakdown-pts pts-uefa" style="opacity:0.3">0 UE</span>'}
          ${team.domestic_cup_points ? `<span class="breakdown-pts pts-cup" title="Cup Points">${team.domestic_cup_points} CP</span>` : '<span class="breakdown-pts pts-cup" style="opacity:0.3">0 CP</span>'}
        </div>
      `;
        }).join('');
    }

    /**
     * Renders the Goals Pool view.
     * @param {Array} goalsPool - Sorted array of participant goal standings
     * @returns {string} HTML string
     */
    function renderGoalsPool(goalsPool) {
        if (!goalsPool || goalsPool.length === 0) {
            return '<div class="error-state">No goals pool data available.</div>';
        }

        let html = `
      <div class="pool-summary">
        <span class="pool-label">Player Goals Pool</span>
        <span class="pool-amount">$300</span>
      </div>
      <div class="standings-list">
    `;

        goalsPool.forEach((entry, idx) => {
            const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
            const badgeClass = entry.rank > 3 ? 'rank-other' : '';

            html += `
        <div class="standing-row ${rankClass}" data-idx="${idx}">
          <div class="standing-main" onclick="App.toggleAccordion(this)">
            <div class="rank-badge ${badgeClass}">${entry.rank}</div>
            <div class="participant-name">${escapeHtml(entry.participant)}</div>
            <div>
              <div class="stat-value">${entry.total_goals}</div>
              <div class="stat-label">Goals</div>
            </div>
            <span class="expand-icon">▼</span>
          </div>
          <div class="breakdown">
            <div class="breakdown-inner">
              ${renderGoalsBreakdown(entry.players)}
            </div>
          </div>
        </div>
      `;
        });

        html += '</div>';
        return html;
    }

    /**
     * Renders player goal breakdown accordion content.
     * @param {Array} players
     * @returns {string} HTML string
     */
    function renderGoalsBreakdown(players) {
        if (!players || players.length === 0) return '<div class="breakdown-item">No players</div>';

        // Sort by goals descending within the breakdown
        const sorted = [...players].sort((a, b) => b.goals - a.goals);

        return sorted.map(player => {
            return `
        <div class="breakdown-item">
          <div class="breakdown-name">${escapeHtml(player.name)}</div>
          <div class="breakdown-stat">${player.goals} ⚽</div>
        </div>
      `;
        }).join('');
    }

    /**
     * Renders the Winningz view with payout cards.
     * @param {Array} teamPool - Team standings
     * @param {Array} goalsPool - Goals standings
     * @returns {string} HTML string
     */
    function renderWinningz(teamPool, goalsPool) {
        const teamPayouts = computePoolPayouts(teamPool, 'total_points');
        const goalsPayouts = computePoolPayouts(goalsPool, 'total_goals');

        return `
      <div class="winningz-grid">
        ${renderPayoutCard('Team Pot', 'team-card', teamPayouts)}
        ${renderPayoutCard('Goals Pot', 'goals-card', goalsPayouts)}
      </div>
    `;
    }

    /**
     * Compute payouts for display from standings data.
     * @param {Array} pool - Standings array
     * @param {string} totalKey - Key name for total (total_points or total_goals)
     * @returns {Array} payouts
     */
    function computePoolPayouts(pool, totalKey) {
        if (!pool || pool.length === 0) return [];

        const sorted = [...pool].sort((a, b) => b[totalKey] - a[totalKey]);
        const topScore = sorted[0][totalKey];
        const tiedForFirst = sorted.filter(s => s[totalKey] === topScore);

        if (tiedForFirst.length >= 2) {
            const splitAmount = Math.floor(300 / tiedForFirst.length);
            return tiedForFirst.map(s => ({
                participant: s.participant,
                total: s[totalKey],
                payout: splitAmount,
                place: '1st (T)',
                isTied: true,
            }));
        }

        const payouts = [
            {
                participant: sorted[0].participant,
                total: sorted[0][totalKey],
                payout: 250,
                place: '1st',
                isTied: false,
            },
        ];

        if (sorted.length > 1) {
            payouts.push({
                participant: sorted[1].participant,
                total: sorted[1][totalKey],
                payout: 50,
                place: '2nd',
                isTied: false,
            });
        }

        return payouts;
    }

    /**
     * Renders a single payout card.
     * @param {string} title
     * @param {string} cardClass
     * @param {Array} payouts
     * @returns {string} HTML
     */
    function renderPayoutCard(title, cardClass, payouts) {
        let entriesHtml = '';

        payouts.forEach(p => {
            const isFirst = p.place.startsWith('1st');
            const placeClass = isFirst ? 'first-place' : 'second-place';
            const amountClass = isFirst ? 'money' : 'money-back';
            const tieHtml = p.isTied ? '<span class="tie-badge">Tied</span>' : '';

            entriesHtml += `
        <div class="payout-entry ${placeClass}">
          <div class="payout-place">
            <div class="payout-place-badge">${p.place.replace(' (T)', '')}</div>
            <div>
              <div class="payout-name">${escapeHtml(p.participant)} ${tieHtml}</div>
              <div class="stat-label" style="text-align: left; margin-top: 2px;">${p.total} ${title.includes('Team') ? 'pts' : 'goals'}</div>
            </div>
          </div>
          <div class="payout-amount ${amountClass}">
            $${p.payout}
          </div>
        </div>
      `;
        });

        const note = payouts.some(p => p.isTied)
            ? 'Tied at 1st — $300 pot split evenly. 2nd place receives $0.'
            : '1st place: $250 • 2nd place: $50 (money back)';

        return `
      <div class="payout-card ${cardClass}">
        <div class="payout-header">
          <div class="payout-title">${title}</div>
          <div class="payout-pot">$300</div>
        </div>
        <div class="payout-entries">
          ${entriesHtml}
        </div>
        <div class="payout-note">${note}</div>
      </div>
    `;
    }

    /**
     * Escape HTML entities to prevent XSS.
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Public API
    return {
        renderTeamPool,
        renderGoalsPool,
        renderWinningz,
    };
})();
