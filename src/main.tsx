import './browserMedia';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { NativeSource } from './NativeSource';
import { startNativeMedia } from './nativeMedia';
const stopMedia = startNativeMedia();
window.addEventListener('beforeunload', stopMedia);

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.projectionSource ? <NativeSource /> : <App />}</React.StrictMode>);
