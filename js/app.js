/**
 * Soccer Pool Tracker — App Controller
 * Handles tab routing, data loading, and accordion state.
 */

const App = (() => {
    let data = null;
    let currentView = 'teams';

    /**
     * Initialize the application.
     */
    async function init() {
        setupTabListeners();
        await loadData();
        render();
    }

    /**
     * Fetch the pre-computed results.json.
     */
    async function loadData() {
        try {
            const response = await fetch('data/results.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
            updateSyncTime(data.last_updated);
        } catch (err) {
            console.error('Failed to load results:', err);
            document.getElementById('content').innerHTML =
                '<div class="error-state">⚠️ Failed to load standings data. Please try again later.</div>';
        }
    }

    /**
     * Set up click listeners for tab navigation.
     */
    function setupTabListeners() {
        const tabNav = document.getElementById('tab-nav');
        tabNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;

            // Update active states
            tabNav.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            // Switch view
            currentView = btn.dataset.view;
            render();
        });
    }

    /**
     * Render the current active view.
     */
    function render() {
        if (!data) return;

        const content = document.getElementById('content');
        let html = '';

        switch (currentView) {
            case 'teams':
                html = Views.renderTeamPool(data.team_pool);
                break;
            case 'goals':
                html = Views.renderGoalsPool(data.goals_pool);
                break;
            case 'winningz':
                html = Views.renderWinningz(data.team_pool, data.goals_pool);
                break;
        }

        content.innerHTML = `<div class="view active">${html}</div>`;
    }

    /**
     * Toggle accordion on a standing row.
     * @param {HTMLElement} mainEl - The clicked .standing-main element
     */
    function toggleAccordion(mainEl) {
        const row = mainEl.closest('.standing-row');
        if (!row) return;

        // Close all other open accordions
        const allRows = row.parentElement.querySelectorAll('.standing-row.expanded');
        allRows.forEach(r => {
            if (r !== row) r.classList.remove('expanded');
        });

        // Toggle this one
        row.classList.toggle('expanded');
    }

    /**
     * Update the footer sync time display.
     * @param {string} isoDate - ISO 8601 date string
     */
    function updateSyncTime(isoDate) {
        const el = document.getElementById('sync-time');
        if (!el || !isoDate) return;

        const date = new Date(isoDate);
        const formatted = date.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
        }) + ' ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
        });

        el.innerHTML = `<span class="sync-dot"></span>Last Sync: ${formatted}`;
    }

    // Public API
    return {
        init,
        toggleAccordion,
    };
})();

// Boot the app when DOM is ready
document.addEventListener('DOMContentLoaded', App.init);
