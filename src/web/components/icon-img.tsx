import React from "react";

export function IconImg({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <div className={className ?? "card-icon"} title={alt}>
        <i className="pi pi-box" />
      </div>
    );
  }
  return <img className={className ?? "card-icon"} src={src} alt={alt} onError={() => setFailed(true)} />;
}
