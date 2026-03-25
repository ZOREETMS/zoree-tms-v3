import { useAuth } from "../state/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div>
      <h2>Settings</h2>
      <div className="card">
        <div>
          <strong>User:</strong> {user?.email || "-"}
        </div>
        <div>
          <strong>API Base:</strong>{" "}
          {import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api"}
        </div>
      </div>
    </div>
  );
}
