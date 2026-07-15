import React from 'react';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';

/* Ionic core CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

import './theme/variables.css';
import './styles/modern-transport.css';

import { AuthProvider, useAuth } from './context/AuthContext';
import { TripProvider } from './context/TripContext';
import { OfflineProvider } from './context/OfflineContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';

import LoginPage from './pages/LoginPage';
import TripSetupPage from './pages/TripSetupPage';
import ScanPage from './pages/ScanPage';
import LiveTripPage from './pages/LiveTripPage';
import TripSummaryPage from './pages/TripSummaryPage';
import ProfilePage from './pages/ProfilePage';
import PassengerListPage from './pages/PassengerListPage';
import TripHistoryPage from './pages/TripHistoryPage';

setupIonicReact({
  mode: 'md',
  animated: true,
});

const App: React.FC = () => {
  return (
    <IonApp>
      <ThemeProvider>
      <AuthProvider>
        <TripProvider>
          <OfflineProvider>
            <IonReactRouter>
              <IonRouterOutlet>
                {/* Public */}
                <Route exact path="/login" component={LoginPage} />

                {/* Protected */}
                <Route exact path="/trip-setup" render={() => <ProtectedRoute component={TripSetupPage} />} />
                <Route exact path="/scan"       render={() => <ProtectedRoute component={ScanPage} />} />
                <Route exact path="/live-trip"  render={() => <ProtectedRoute component={LiveTripPage} />} />
                <Route exact path="/trip-summary" render={() => <ProtectedRoute component={TripSummaryPage} />} />
                <Route exact path="/profile"    render={() => <ProtectedRoute component={ProfilePage} />} />

                {/* New pages — previously missing from routing */}
                <Route exact path="/passengers" render={() => <ProtectedRoute component={PassengerListPage} />} />
                <Route exact path="/history"    render={() => <ProtectedRoute component={TripHistoryPage} />} />

                {/* Default redirect */}
                <Route exact path="/">
                  <ProtectedRedirect />
                </Route>
              </IonRouterOutlet>
            </IonReactRouter>
          </OfflineProvider>
        </TripProvider>
      </AuthProvider>
      </ThemeProvider>
    </IonApp>
  );
};

function ProtectedRedirect() {
  const { session, profile, loading } = useAuth();
  if (loading) return null;
  if (!session || !profile) return <Redirect to="/login" />;
  return <Redirect to="/trip-setup" />;
}

export default App;
