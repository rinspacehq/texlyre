// SPDX-License-Identifier: AGPL-3.0-or-later

export const rinspaceAgentTheme = {
	'--rinspace-agent-background': 'var(--pico-background)',
	'--rinspace-agent-foreground': 'var(--pico-color)',
	'--rinspace-agent-surface':
		'var(--pico-card-background-color, var(--pico-background))',
	'--rinspace-agent-border': 'var(--accent-border)',
	'--rinspace-agent-input': 'var(--pico-form-element-border-color)',
	'--rinspace-agent-primary': 'var(--pico-primary)',
	'--rinspace-agent-primary-foreground': 'var(--pico-primary-inverse)',
	'--rinspace-agent-secondary': 'var(--pico-primary-focus)',
	'--rinspace-agent-muted-foreground': 'var(--pico-muted-color)',
	'--rinspace-agent-accent': 'var(--pico-primary-focus)',
	'--rinspace-agent-accent-foreground': 'var(--pico-color)',
	'--rinspace-agent-destructive': 'var(--pico-del-color, var(--color-error))',
	'--rinspace-agent-focus-ring': 'var(--pico-primary)',
	'--rinspace-agent-font-family': 'inherit',
	'--rinspace-agent-radius': 'var(--radius-sm)',
} as const;
