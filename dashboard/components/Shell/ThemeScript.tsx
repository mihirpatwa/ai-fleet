// Blocking, pre-hydration script. Runs synchronously as the first thing in
// <body> so the viewport background is correct BEFORE React paints — this is
// what kills the dark→light (or reverse) flash on first load (FOUC).
//
// It reads the SAME localStorage key the useTheme zustand store persists to
// ("aifleet-theme", shape {"state":{"mode":...}}). The bg map MUST stay in
// sync with LAYOUT_BG in lib/theme.ts.
const SCRIPT = `(function(){try{
var bg={light:'#f5f5f5',dark:'#0b0d12'};
var mode='system';
var raw=localStorage.getItem('aifleet-theme');
if(raw){var m=JSON.parse(raw);if(m&&m.state&&m.state.mode)mode=m.state.mode;}
var dark=mode==='dark'||(mode==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var r=document.documentElement;
r.dataset.theme=dark?'dark':'light';
r.style.colorScheme=dark?'dark':'light';
r.style.background=dark?bg.dark:bg.light;
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
