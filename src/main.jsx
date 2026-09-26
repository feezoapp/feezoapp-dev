import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import './styles/global.css';
import App from './App.jsx';
import LandingPage from './pages/LandingPage.jsx';
import LoginScreen from './pages/LoginScreen.jsx';
import SignupScreen from './pages/SignupScreen.jsx';
import SignupSuccessScreen from './pages/SignupSuccessScreen.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public marketing page */}
          <Route path="/" element={<LandingPage />} />
          {/* Public auth pages are explicit routes so CTA links always render the correct screen. */}
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/signup" element={<SignupScreen />} />
          <Route path="/signup/success" element={<SignupSuccessScreen />} />
          {/* Authenticated app + legacy fallback handling */}
          <Route path="/*" element={<App />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
