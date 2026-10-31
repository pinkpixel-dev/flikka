// The flikka panel (flikka app panel): bundled by lib/ui.mjs with esbuild into the cache.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@hyperframes/player';
import './styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.jsx';
import {listenForPresses} from './lib/sound.js';

listenForPresses();
createRoot(document.getElementById('app')).render(<App/>);
