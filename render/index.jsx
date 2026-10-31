// A composition's page script (lib/compose.mjs writes the page): a recording's edit (Demo) or a film,
// drawn from the props the page carries. Custom scenes are registered before start() runs.
import {mount} from './frame.jsx';
import {Demo} from './parts.jsx';
import {Film, layoutIssues} from './film.jsx';

export function start() {
  const {kind, props, config} = window.FLIKKA;
  // Frame sheets ask for the timecode stamp in the address: the same composition serves both.
  if (kind === 'film') props.film = {...props.film, stamp: new URLSearchParams(location.search).has('stamp')};
  window.flikkaLayout = () => layoutIssues(config.width, config.height);
  mount(document.getElementById('app'), kind === 'film' ? Film : Demo, props, config);
}
