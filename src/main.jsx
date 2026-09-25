import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import './styles/global.css';
import App from './App.jsx';
import LandingPage from './pages/LandingPage.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public marketing page — lives outside the authenticated app shell */}
          <Route path="/" element={<LandingPage />} />
          {/* Everything else (including the login gate) is handled inside App */}
          <Route path="/*" element={<App />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
