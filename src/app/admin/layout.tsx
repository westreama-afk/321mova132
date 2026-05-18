import "@/styles/admin-bootstrap.css";
import type { Metadata } from "next";
import AdminStyleProvider from "@/components/sections/Admin/AdminStyleProvider";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminStyleProvider>{children}</AdminStyleProvider>;
}
