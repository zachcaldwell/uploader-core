import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'test',
	testMatch: '*.spec.ts',
	// Firefox and WebKit belong here too, once they're installed where this runs.
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
