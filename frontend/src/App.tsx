import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Channels from "./pages/Channels";
import AggregateKeys from "./pages/AggregateKeys";
import Playground from "./pages/Playground";
import Stats from "./pages/Stats";
import HealthOverview from "./pages/HealthOverview";
import Users from "./pages/Users";
import Profile from "./pages/Profile";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  // 简单检查：实际可以从 user 状态判断
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="channels" element={<Channels />} />
        <Route path="aggregate-keys" element={<AggregateKeys />} />
        <Route path="playground" element={<Playground />} />
        <Route path="stats" element={<Stats />} />
        <Route path="health" element={<HealthOverview />} />
        <Route path="profile" element={<Profile />} />
        <Route
          path="users"
          element={
            <AdminRoute>
              <Users />
            </AdminRoute>
          }
        />
      </Route>
    </Routes>
  );
}
