import { busyTexOutcomeSucceeded } from '../../../src/extensions/texlyre-busytex/BusyTeXResult';

test('warnings and successful TeX output do not become fatal errors', () => {
	expect(busyTexOutcomeSucceeded({ success:true,exitCode:0,log:'Package fontspec Warning: optional style unavailable',
		logs:[{exit_code:0,log:'Output written on main.xdv',stderr:''},
			{cmd:'bibtex8 --8bit main.aux',exit_code:0,log:'I found no citation commands',stderr:'program exited (with status: 2)'}] })).toBe(true);
});

test('final converter success cannot hide TeX errors, interrupted WASM or earlier failed stages', () => {
	for(const stage of [
		{exit_code:0,log:'! Package fontspec Error:\nThe font cannot be found.',stderr:''},
		{cmd:'xelatex main.tex',exit_code:0,log:'',stderr:'program exited (with status: 1), but keepRuntimeAlive() is set'},
		{exit_code:2,log:'',stderr:''},
	]) expect(busyTexOutcomeSucceeded({success:true,exitCode:0,log:'',logs:[stage]})).toBe(false);
	expect(busyTexOutcomeSucceeded({success:false,exitCode:0,log:''})).toBe(false);
});
