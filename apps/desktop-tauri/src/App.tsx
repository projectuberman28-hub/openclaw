import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";
import Privacy from "./pages/Privacy";
import Skills from "./pages/Skills";
import Forge from "./pages/Forge";
import Playbook from "./pages/Playbook";
import Tasks from "./pages/Tasks";
import Agents from "./pages/Agents";
import Devices from "./pages/Devices";
import Voice from "./pages/Voice";
import Insights from "./pages/Insights";

function App() {
  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:sessionId" element={<Chat />} />
        <Route path="settings" element={<Settings />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="skills" element={<Skills />} />
        <Route path="forge" element={<Forge />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="agents" element={<Agents />} />
        <Route path="devices" element={<Devices />} />
        <Route path="voice" element={<Voice />} />
        <Route path="insights" element={<Insights />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
