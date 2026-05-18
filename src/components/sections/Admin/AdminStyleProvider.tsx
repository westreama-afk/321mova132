"use client";

import { useEffect } from "react";

const BOOTSTRAP_LINK_ID = "admin-bootstrap-runtime";

const ensureBootstrapStylesheet = () => {
  const existing = document.getElementById(BOOTSTRAP_LINK_ID) as HTMLLinkElement | null;
  if (existing) return existing;

  const link = document.createElement("link");
  link.id = BOOTSTRAP_LINK_ID;
  link.rel = "stylesheet";
  link.href = "/vendor/bootstrap.min.css";
  document.head.appendChild(link);
  return link;
};

const AdminStyleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const link = ensureBootstrapStylesheet();
    document.body.classList.add("admin-body-active");

    return () => {
      document.body.classList.remove("admin-body-active");
      link.remove();
    };
  }, []);

  return <div className="admin-route-shell">{children}</div>;
};

export default AdminStyleProvider;
