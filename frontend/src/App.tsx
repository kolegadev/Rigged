import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TradingDashboard, { AuthProvider } from './components/TradingDashboard';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<TradingDashboard />} />
            {/* Add more routes as needed */}
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;