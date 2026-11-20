import { memo } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { SidebarLibrary } from "./SidebarLibrary";
import { SidebarNavItems } from "./SidebarNavItems";
import { SidebarSettingsButton } from "./SidebarSettingsButton";

export interface SidebarProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
  /** the pre-0.2.12 look: logo in the header, a full-height icon rail */
  classic?: boolean;
}

function ClassicSidebar({ searchOpen, onSearchToggle }: SidebarProps) {
  return (
    <div className="h-full w-[58px] rounded-item flex flex-col overflow-hidden bg-bg-glass backdrop-blur-[20px]">
      <nav className="shrink-0 flex flex-col items-center gap-[20px] pt-[16px] pb-[8px]">
        <SidebarNavItems
          searchOpen={searchOpen}
          onSearchToggle={onSearchToggle}
        />
      </nav>
      <div className="flex-1 min-h-0 flex flex-col">
        <SidebarLibrary />
      </div>
      <div className="shrink-0 flex flex-col items-center pt-[8px] pb-[16px]">
        <SidebarSettingsButton />
      </div>
    </div>
  );
}

function Sidebar(props: SidebarProps) {
  if (props.classic) return <ClassicSidebar {...props} />;
  const { searchOpen, onSearchToggle } = props;
  return (
    <div className="h-full w-[52px] flex flex-col items-center gap-[6px]">
      {/* one panel for nav and library; hugs its content and scrolls the
          library once it reaches the window bottom */}
      <div className="w-full min-h-0 flex flex-col rounded-item bg-bg-glass backdrop-blur-[20px]">
        <nav className="shrink-0 flex flex-col items-center gap-[20px] py-[16px]">
          <Link
            to="/"
            title="Liner"
            className="flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          >
            <img
              src={logo}
              alt="Liner"
              width={30}
              height={23}
              className="h-[23px] w-auto object-contain theme-logo invert dark:invert-0 select-none"
              draggable={false}
            />
          </Link>
          <SidebarNavItems
            searchOpen={searchOpen}
            onSearchToggle={onSearchToggle}
          />
          <SidebarSettingsButton />
        </nav>

        <SidebarLibrary />
      </div>
    </div>
  );
}

export default memo(Sidebar);
