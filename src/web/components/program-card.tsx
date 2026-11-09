import React from "react";
import { Tag } from "primereact/tag";
import type { ProgramCard } from "../types.ts";
import { IconImg } from "./icon-img.tsx";
import { navigate } from "../router.ts";

const TYPE_SEVERITY: Record<string, "info" | "success" | "warning" | "danger"> = {
  deb: "info",
  flatpak: "success",
  appimage: "warning",
};

export function ProgramCardView({ card }: { card: ProgramCard }): React.ReactElement {
  return (
    <div
      className="program-card"
      onClick={() => navigate({ tab: "programs", id: card.id })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && navigate({ tab: "programs", id: card.id })}
    >
      <div className="card-head">
        <IconImg src={card.iconUrl} alt={card.name} className="card-icon" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="card-title">{card.name}</div>
          <div className="chip-row" style={{ marginTop: "0.3rem" }}>
            {card.pkg && <Tag value={card.pkg.type} severity={TYPE_SEVERITY[card.pkg.type] ?? "secondary"} />}
            {card.runningCount > 0 && <Tag value={`● ${card.runningCount}`} severity="success" />}
            {card.commandCount > 0 && (
              <span className="stat-pill">
                <i className="pi pi-code" /> {card.commandCount}
              </span>
            )}
          </div>
        </div>
      </div>
      {card.comment && <div className="card-comment">{card.comment}</div>}
      <div className="chip-row" style={{ marginTop: "auto" }}>
        {card.pkg?.version && <span className="stat-pill">{card.pkg.version}</span>}
        {card.pkg?.section && <span className="stat-pill">{card.pkg.section}</span>}
        {card.categories
          .split(";")
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => (
            <span key={c} className="stat-pill">
              {c}
            </span>
          ))}
      </div>
    </div>
  );
}
