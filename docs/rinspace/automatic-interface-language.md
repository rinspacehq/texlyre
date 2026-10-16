# Automatic interface language

New browser profiles default to `system`. The optional workspace `locale` hook
can supply the host's effective UI language; without it, the browser's ordered
language list is matched against the bundled translations, with English fallback.
The same resolver is used before the splash screen is dismissed and by the
settings/provider layer. No translation download or account request is needed.

The Rinspace adapter reads only the existing, same-origin device language
preference. Chinese and English follow the host; its `system` mode uses the
host's browser matching rules. Other origins ignore this product storage key.
Cross-tab preference changes and browser language changes use events, not polling.

Saved editor language choices take precedence. In older versions English was
also persisted automatically, so it cannot safely be reclassified as a deliberate
choice or an unset default. Those profiles retain their saved value. Select
**System** in the existing interface-language picker to return to automatic mode.
Unsupported Traditional Chinese is not presented as a separate translation.

This changes UI preferences only, not project source, browser ownership, platform
identity, permissions, Git state or storage deletion behavior.
