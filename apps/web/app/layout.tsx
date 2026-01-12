import NavBar from "../components/NavBar";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui", margin: 0 }}>
        
        <NavBar />
<div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <a href="/" style={{ fontWeight: 700, textDecoration: "none" }}>CloudGate</a>
            <a href="/login">Вход</a>
            <a href="/dashboard">Кабинет</a>
          </div>
          <hr />
          {children}
        </div>
      </body>
    </html>
  );
}
