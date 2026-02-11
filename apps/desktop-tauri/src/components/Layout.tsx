import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";

export default function Layout() {
  return (
    <div className="flex h-screen bg-batcave-primary overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
