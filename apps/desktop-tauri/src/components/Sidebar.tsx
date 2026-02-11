import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Shield,
  Zap,
  Hammer,
  BookOpen,
  CalendarClock,
  Bot,
  Smartphone,
  Mic,
  BarChart3,
} from "lucide-react";
import { cn } from "../lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/chat", icon: MessageSquare, label: "Chat" },
  { to: "/agents", icon: Bot, label: "Agents" },
  { to: "/skills", icon: Zap, label: "Skills" },
  { to: "/forge", icon: Hammer, label: "Forge" },
  { to: "/playbook", icon: BookOpen, label: "Playbook" },
  { to: "/tasks", icon: CalendarClock, label: "Tasks" },
  { to: "/privacy", icon: Shield, label: "Privacy" },
  { to: "/insights", icon: BarChart3, label: "Insights" },
  { to: "/voice", icon: Mic, label: "Voice" },
  { to: "/devices", icon: Smartphone, label: "Devices" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside className="w-16 hover:w-48 group/sidebar bg-batcave-secondary border-r border-batcave-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-batcave-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-batcave-accent flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="ml-3 font-semibold text-batcave-text whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          Alfred
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center px-4 py-2.5 mx-1.5 my-0.5 rounded-lg transition-all duration-200",
                "text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover",
                isActive &&
                  "text-batcave-accent bg-batcave-accent/10 hover:text-batcave-accent"
              )
            }
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-sm whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Version */}
      <div className="px-4 py-3 border-t border-batcave-border shrink-0">
        <span className="text-xs text-batcave-text-muted whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          v3.0.0
        </span>
      </div>
    </aside>
  );
}
