import { defineConfig, devices } from '@playwright/test';

// The site's own checks, against the real build served on localhost (where service workers run).
export default defineConfig({
	testDir: '.',
	testMatch: 'site.spec.ts',
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command: 'node site/build.mjs --serve',
		cwd: '..',
		url: 'http://localhost:4173',
		reuseExistingServer: false
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
