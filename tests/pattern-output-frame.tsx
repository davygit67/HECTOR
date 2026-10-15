import React from 'react';
import { createRoot } from 'react-dom/client';
import { PatternOutput } from '../src/CalibrationOutput';
import '../src/hardware.css';
createRoot(document.getElementById('root')!).render(<PatternOutput><div id="original-scene" style={{ minHeight: '100vh', background: '#234c40', color: 'white' }}>Original content stays mounted.</div></PatternOutput>);
