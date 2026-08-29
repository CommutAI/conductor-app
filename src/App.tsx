import React from 'react';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';

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

import './index.css';
import './theme/variables.css';
import './styles/modern-transport.css';

import { AppProvider } from './context/AppContext';
import { NetworkProvider } from './context/NetworkContext';
import ProtectedRoute from './components/ProtectedRoute';
import InteractiveBackground from './components/layout/InteractiveBackground';

import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ScanPage from './pages/ScanPage';
import TripSummaryPage from './pages/TripSummaryPage';
import ProfilePage from './pages/ProfilePage';
import PassengerListPage from './pages/PassengerListPage';
import TripHistoryPage from './pages/TripHistoryPage';

setupIonicReact({
  mode: 'md',
  animated: false,
  swipeBackEnabled: false,
});

addIcons({
  'close': close,
});

const App: React.FC = () => {
  return (
    <IonApp>
      <InteractiveBackground />
      <AppProvider>
        <NetworkProvider>
          <IonReactRouter>
            <IonRouterOutlet>
              {/* Public */}
              <Route exact path="/login" component={LoginPage} />

              {/* Protected */}
              <Route exact path="/"          render={() => <ProtectedRoute component={HomePage} />} />
              <Route exact path="/scan"       render={() => <ProtectedRoute component={ScanPage} />} />
              <Route exact path="/trip-summary" render={() => <ProtectedRoute component={TripSummaryPage} />} />
              <Route exact path="/profile"    render={() => <ProtectedRoute component={ProfilePage} />} />

              {/* Additional pages */}
              <Route exact path="/passengers" render={() => <ProtectedRoute component={PassengerListPage} />} />
              <Route exact path="/history"    render={() => <ProtectedRoute component={TripHistoryPage} />} />

              <Route render={() => <Redirect to="/" />} />
            </IonRouterOutlet>
          </IonReactRouter>
        </NetworkProvider>
      </AppProvider>
    </IonApp>
  );
};

export default App;
