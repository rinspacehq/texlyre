// texlyre.config.ts
import type { TexlyreConfig } from '@/types/texlyre';

const config: TexlyreConfig = {
    title: 'Rinspace Online Editor',
    tagline: 'A local-first LaTeX & Typst collaborative web editor',
    url: 'https://rinspace.com',
    baseUrl: '/editor/',
    organizationName: 'texlyre',
    projectName: 'texlyre',
    favicon: './favicon.ico',

    startup: { profile: 'persistent-local' },


    airgap: {
        allowedDomains: [
            'texlyre.github.io',
            'texlyre.org',
            'typst.org',
        ],
        allowedProtocols: [
            'https:',
            'http:',
            // Collaboration is blocked by airgap but allow ws anyway
            'wss:',
            'ws:',
        ],
    },

    pwa: {
        enabled: true,
        themeColor: {
            light: '#fafafa',
            dark: '#11191f',
            fallback: '#11191f',
        },
        manifest: './manifest.json',
        startUrl: './',
        backgroundColor: {
            light: '#fafafa',
            dark: '#11191f',
            fallback: '#11191f',
        },
        icons: [
            {
                src: './favicon-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any maskable',
            },
        ],
        display: 'standalone',
        // All of these are OPTIONAL; if omitted, the script will fall back
        // to title & tagline.
        // name: 'TeXlyre',
        // shortName: 'TeXlyre',
        // description: 'A local-first LaTeX & Typst collaborative web editor',
    },

    plugins: {
        collaborative_viewers: ['bibtex', 'drawio', 'tikz', 'milkdown'],
        viewers: ['bibtex', 'image', 'media', 'pdf', 'drawio', 'tikz', 'milkdown'],
        renderers: ['pdf', 'canvas'],
        loggers: ['latex_visualizer', 'typst_visualizer'],
        bibliography: ['zotero', 'openalex', 'rinspace'], // 'jabref'
        lsp: [],
        backup: ['github', 'gitlab', 'forgejo', 'gitea'],
        themes: ['texlyre_slim', 'texlyre_wide', 'texlyre_compact', 'texlyre_mobile'],
        workspace: ['rinspace'],
    },

    // Overwrite priority is default < local < mobile for corresponding configs
    userdata: {
        version: '1.3.8',
        forceUpdate: {
            settings: [
                'statusPageUrl',
                'statusJsonUrl',
                'latexTexliveEndpoint',
                'latexBusytexEndpoint',
                'latexEngine',
                'themePlugin',
                'fileSyncNotifications',
            ],
            properties: [],
        },
        default: {
            settings: {
                bibtexViewerAutoTidy: false,
                bibtexViewerTidyOptions: 'standard',
                canvasRendererAnnotations: true,
                canvasRendererEnable: true,
                canvasRendererInitialZoom: '100',
                canvasRendererTextSelection: true,
                collabAutoReconnect: false,
                collabAwarenessTimeout: 30,
                collabProviderType: 'webrtc',
                collabSignalingServers: 'wss://ywebrtc.texlyre.org',
                editorAutoSaveDelay: 1000,
                editorAutoSaveEnable: true,
                editorFontFamily: 'monospace',
                editorFontSize: 'lg',
                editorShowLineNumbers: true,
                editorSpellCheck: false,
                editorSyntaxHighlighting: true,
                editorThemeHighlights: 'auto',
                fileSyncAutoInterval: 10,
                fileSyncConflictResolution: 'prefer-latest',
                fileSyncEnable: true,
                fileSyncHoldTimeout: 30,
                fileSyncNotifications: 'all',
                fileSyncRequestTimeout: 60,
                fileSyncServerUrl: 'https://filepizza.texlyre.org',
                fileSysBackupAutoBackup: false,
                fileSysBackupEnable: true,
                fileTreeFilesystemDragDrop: true,
                fileTreeInternalDragDrop: true,
                imageViewerAutoCenter: true,
                imageViewerEnableFilters: true,
                imageViewerQuality: 'high',
                latexEngine: 'busytex-xetex',
                latexDefaultFormat: 'pdf',  // 'canvas-pdf'
                latexStoreCache: true,
                latexStoreWorkingDirectory: false,
                // The complete fixed TeX Live tree is served by Rinspace as
                // immutable files. Compilation remains in the browser.
                latexTexliveEndpoint: '',
                latexBusytexEndpoint: '/editor/texlive/2026',
                pdfRendererAnnotations: true,
                pdfRendererEnable: true,
                pdfRendererInitialZoom: '100',
                pdfRendererTextSelection: true,
                pdfViewerAutoScale: true,
                pdfViewerRenderingQuality: 'high',
                repositoryProxyUrl: 'https://proxy.texlyre.org/?url=',
                latexSourcemapEnable: true,
                // A release may provide its own status feed. Do not poll the
                // upstream mutable GitHub file from the default local editor.
                statusJsonUrl: '',
                statusPageUrl: '',
                templatesApiUrl: 'https://texlyre.github.io/texlyre-templates/api/templates.json',
                themePlugin: 'texlyre-compact-theme',
                themeVariant: 'system',
                typstAutoCompileOnOpen: false,
                typstDefaultFormat: 'canvas',
                typstSourcemapEnable: true,
            },
            properties: {
                global: {
                    latexOutputCollapsed: true,
                    latexOutputWidth: 700,
                    logVisualizerHeight: 600,
                    logVisualizerCollapsed: false,
                    pdfRendererZoom: 1,
                    pdfRendererScrollView: true,
                    canvasRendererZoom: 1,
                    canvasRendererScrollView: true,
                    sidebarCollapsed: false,
                    sidebarWidth: 502,
                    sourcemapShowFloatingButtons: true,
                    themeToggleLight: 'atom_light',
                    themeToggleDark: 'tomorrow_night_blue',
                    toolbarVisible: true,
                },
            },
            secrets: {},
            records: {},
        },
        mobile: {
            settings: {
                fileSysBackupEnable: false,
                themePlugin: 'texlyre-mobile-theme',
                imageViewerAutoCenter: true,
            },
            properties: {
                global: {
                    projectListViewMode: 'list',
                }
            }
        },
        local: {
            settings: {
                latexEngine: 'busytex-xetex',
                collabSignalingServers: 'ws://localhost:4444/',
                fileSyncServerUrl: 'http://localhost:8080',
                latexBusytexEndpoint: 'http://localhost:8070',
                latexTexliveEndpoint: 'http://localhost:5004',
                statusJsonUrl: '',
                statusPageUrl: '',
                themeVariant: 'dark',
            },
            properties: {
                global: {
                    pdfRendererScrollView: false,
                },
            },
        },
    },
};

export default config;
