import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TradingDashboard, { AuthProvider } from './components/TradingDashboard';
import { WebSocketProvider } from './contexts/WebSocketContext';

function App() {
  return (
    <AuthProvider>
      <WebSocketProvider>
        <Router>
          <div className="App">
            <Routes>
              <Route path="/" element={<TradingDashboard />} />
              {/* Add more routes as needed */}
            </Routes>
          </div>
        </Router>
      </WebSocketProvider>
    </AuthProvider>
  );
}

export default App;
