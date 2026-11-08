import React, {useEffect, useRef} from 'react';
import {Keyboard, X} from 'lucide-react';
import {Button} from './ui.jsx';

// Every key the panel answers to. Keep it in step with usePlayerKeys, Timeline, Aim, Scenes and FilmStudio.
const groups = [
  ['Player', [[['Space'], 'Play or pause'], [['K'], 'Play or pause'], [['←', '→'], 'Back or forward one frame'], [['Shift', '←', '→'], 'Back or forward one second'],
    [['Home', 'End'], 'Start or end'], [['M'], 'Mute']]],
  ['Editing', [[['Ctrl', 'Z'], 'Undo the last edit'], [['Ctrl', 'S'], 'Save the open scene (films)']]],
  ['Timeline, when focused', [[['←', '→'], 'Move the playhead a frame (Shift: a second)'], [['Enter'], 'Cut the selection, or choose the zoom under the playhead'],
    [['[', ']'], 'Previous or next zoom'], [['Z'], 'Pick the click or typing nearest the playhead'], [['A'], 'Aim the chosen zoom'],
    [['Delete'], 'Remove the chosen zoom'], [['Esc'], 'Clear the selection']]],
  ['Aiming a zoom', [[['←', '↑', '↓', '→'], 'Move where it looks (Shift: further)'], [['Enter'], 'Save'], [['Esc'], 'Cancel']]],
  ['Film scenes', [[['Alt', '←', '→'], 'Move the focused scene']]],
  ['Anywhere', [[['?'], 'Show these shortcuts']]],
];

const typing = target => target.closest?.('input, textarea, select, [contenteditable]');

// The shortcuts sheet: the button at the foot of the sidebar, or ? from anywhere outside a text field.
export function Shortcuts() {
  const dialog = useRef(null);
  const toggle = () => { const sheet = dialog.current; if (sheet) sheet.open ? sheet.close() : sheet.showModal(); };
  useEffect(() => {
    const keys = event => { if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing(event.target)) { event.preventDefault(); toggle(); } };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);
  return <>
    <Button className="shortcuts-button" variant="ghost" size="small" icon={Keyboard} tip="Keyboard shortcuts (?)" onClick={toggle}>Shortcuts</Button>
    <dialog ref={dialog} className="shortcuts" aria-labelledby="shortcuts-title" onClick={event => event.target === event.currentTarget && event.currentTarget.close()}>
      <header><h2 id="shortcuts-title">Keyboard shortcuts</h2><Button variant="ghost" size="small" icon={X} tip="Close (Esc)" onClick={() => dialog.current.close()}/></header>
      <div className="shortcut-groups">
        {groups.map(([title, rows]) => <section key={title}>
          <h3>{title}</h3>
          <dl>{rows.map(([keys, what]) => <div key={keys.join() + what}><dt>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dt><dd>{what}</dd></div>)}</dl>
        </section>)}
      </div>
    </dialog>
  </>;
}
