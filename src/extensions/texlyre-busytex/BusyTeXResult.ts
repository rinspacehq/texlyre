// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LogEntry } from 'texlyre-busytex';

type CompilerOutcome = {
	success: boolean;
	exitCode: number;
	log: string;
	logs?: readonly (Pick<LogEntry, 'log' | 'stderr' | 'exit_code'> & Partial<Pick<LogEntry, 'cmd'>>)[];
};

// Some WASM TeX failures leave a partial XDV that xdvipdfmx successfully turns
// into a PDF. The final process status alone must not override a fatal TeX log.
export function busyTexOutcomeSucceeded(result: CompilerOutcome): boolean {
	if (!result.success || result.exitCode !== 0 || /^!\s/m.test(result.log)) return false;
	return !(result.logs ?? []).some(stage => {
		if (stage.exit_code !== 0 || /^!\s/m.test(stage.log)) return true;
		// BusyTeX deliberately probes BibTeX on documents without citations;
		// its ignored WASM status 2 is not a fatal TeX compilation failure.
		const texCommand = /^(?:\S*\/)?(?:xelatex|xetex|pdflatex|pdftex|lualatex|luahbtex|luatex)(?:\s|$)/.test(stage.cmd ?? '');
		return texCommand && /program exited \(with status: [1-9][0-9]*\)/.test(stage.stderr);
	});
}
