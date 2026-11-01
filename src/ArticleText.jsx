import React from "react";

// Render trusted publication links as ordinary accessible anchors without HTML injection.
export default function ArticleText({ body = "" }) {
  const text = typeof body === "string" ? body : "";
  const parts = text.split(/(https:\/\/[^\s]+)/g);
  return <p className="pre-line">
    {parts.map((piece, i) => piece.startsWith("https://")
      ? <a href={piece} key={i} target="_blank" rel="noopener noreferrer">{piece}</a>
      : piece)}
  </p>;
}
