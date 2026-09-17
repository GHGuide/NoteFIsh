import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './design.css'; // pages import their own CSS after these, so page rules win
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
