"use client";

import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardList,
  Gamepad2,
  Heart,
  Mail,
  Menu,
  QrCode,
  ScanFace,
  ScanLine,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GAME_MODULES } from "@/lib/game/catalog";
import styles from "./home.module.css";
import { GuestJourney } from "@/components/landing/GuestJourney";

type ScrollCraftRuntime = {
  mount: (root: HTMLElement) => { destroy: () => void };
};

const CAPABILITIES = [
  {
    icon: ClipboardList,
    title: "Biểu mẫu & CME",
    text: "Đăng ký, khảo sát và post-test theo nội dung hội thảo.",
    href: "/admin/forms",
  },
  {
    icon: ScanFace,
    title: "Face check-in VIP",
    text: "Đón khách bằng nhận diện khuôn mặt.",
    href: "/admin/forms",
  },
  {
    icon: Mail,
    title: "Email & thiệp mời",
    text: "Gửi thư cá nhân hóa từ danh sách Excel.",
    href: "/admin/tools/mail-merge",
  },
  {
    icon: BarChart3,
    title: "Báo cáo tham dự",
    text: "Xem đăng ký, điểm danh theo buổi và xuất Excel.",
    href: "/admin/forms",
  },
];

const FEATURED = ["quiz", "wheel", "trucxanh", "handslice"]
  .map((id) => GAME_MODULES.find((game) => game.id === id))
  .filter((game) => game !== undefined);

const GAME_DESCRIPTIONS: Record<string, string> = {
  quiz: "Cùng thử tài kiến thức",
  wheel: "Một vòng quay, nhiều bất ngờ",
  trucxanh: "Lật ô, tìm cặp, kết nối",
  handslice: "Chuyển động để nhập cuộc",
};

export default function HomePage() {
  const rootRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const reduceMotion = useReducedMotion();
  const startHref = signedIn ? "/admin" : "/signup";
  const startLabel = signedIn ? "Vào dashboard" : "Bắt đầu ngay";

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (mounted) setSignedIn(Boolean(session));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const runtime = (window as Window & { ScrollCraft?: ScrollCraftRuntime })
      .ScrollCraft;
    if (!runtimeReady || !rootRef.current || !runtime || reduceMotion) return;
    const instance = runtime.mount(rootRef.current);
    return () => instance.destroy();
  }, [runtimeReady, reduceMotion]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  function moveGallery(direction: number) {
    const rail = galleryRef.current;
    if (rail)
      rail.scrollBy({
        left: direction * rail.clientWidth * 0.75,
        behavior: reduceMotion ? "instant" : "smooth",
      });
  }

  return (
    <main ref={rootRef} className={styles.home}>
      <Script
        src="/landing/scrollcraft.js"
        strategy="afterInteractive"
        onReady={() => setRuntimeReady(true)}
      />
      <a className={styles.skipLink} href="#main-content">
        Đến nội dung chính
      </a>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link
            href="/"
            className={styles.brand}
            aria-label="I-solution Manager, trang chủ"
          >
            <span className={styles.brandMark}>
              <QrCode size={22} strokeWidth={1.7} />
            </span>
            <span>
              I-solution <span className={styles.brandSuffix}>Manager</span>
            </span>
          </Link>
          <nav className={styles.desktopNav} aria-label="Điều hướng chính">
            <a href="#how">Quy trình</a>
            <a href="#features">Giải pháp</a>
            <a href="#games">Game tương tác</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.loginLink}>
              Đăng nhập
            </Link>
            <Link
              href={startHref}
              className={`${styles.button} ${styles.buttonSmall}`}
            >
              {startLabel}
              <ArrowUpRight size={16} />
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.menuButton}
              aria-expanded={menuOpen}
              aria-controls="home-mobile-nav"
              aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="home-mobile-nav"
            className={styles.mobileNav}
            aria-label="Điều hướng trên điện thoại"
            onClick={() => setMenuOpen(false)}
          >
            <a href="#how">
              Quy trình <ChevronRight size={17} />
            </a>
            <a href="#features">
              Giải pháp <ChevronRight size={17} />
            </a>
            <a href="#games">
              Game tương tác <ChevronRight size={17} />
            </a>
            <Link href="/login">
              Đăng nhập <ArrowUpRight size={17} />
            </Link>
          </nav>
        )}
      </header>

      <section
        id="main-content"
        className={styles.hero}
        data-sc-act="flow"
        aria-labelledby="hero-heading"
      >
        <div className={`${styles.container} ${styles.heroInner}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span /> Từ lời mời đến lời chào
            </p>
            <h1 id="hero-heading">
              Sự kiện chỉn chu.
              <br />
              <span>Từ lần chạm đầu.</span>
            </h1>
            <p className={styles.heroDescription}>
              Đăng ký, gửi thư mời, check-in và kết nối khách tham dự trong cùng
              một nền tảng.
            </p>
            <div className={styles.heroActions}>
              <Link href={startHref} className={styles.button}>
                {startLabel}
                <ArrowUpRight size={18} />
              </Link>
              <a href="#how" className={styles.textLink}>
                Khám phá quy trình <ArrowRight size={17} />
              </a>
            </div>
          </div>
          <div
            className={styles.heroScene}
            role="img"
            aria-label="Minh họa thư mời, thẻ khách QR và xác nhận check-in kết nối trong một hành trình"
          >
            <div
              className={styles.sceneOrbit}
              data-sc-parallax="0.5"
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </div>
            <div
              className={styles.invitePlane}
              data-sc-parallax="-0.45"
              aria-hidden="true"
            >
              <div className={styles.invitePaper}>
                <Image
                  src="/landing/conference-invitation.webp"
                  alt=""
                  width={1054}
                  height={1493}
                  sizes="234px"
                  priority
                />
              </div>
            </div>
            <div
              className={styles.passPlane}
              data-sc-parallax="-1.15"
              aria-hidden="true"
            >
              <div className={styles.passTilt} data-sc-tilt="3">
                <div className={styles.guestPass}>
                  <div className={styles.passTop}>
                    <QrCode size={20} />
                    <span>I-solution Manager</span>
                    <ArrowUpRight size={17} />
                  </div>
                  <div className={styles.passBody}>
                    <span className={styles.passTag}>GUEST PASS</span>
                    <h2>
                      Chào mừng
                      <br />
                      bạn đến!
                    </h2>
                    <p>Một mã QR. Trọn hành trình.</p>
                    <Image
                      src="/landing/guest-pass.svg"
                      alt=""
                      width={146}
                      height={146}
                      priority
                    />
                    <span className={styles.passCaption}>QR MINH HỌA</span>
                  </div>
                  <div className={styles.passTear}>
                    <span />
                    <i />
                    <span />
                  </div>
                  <div className={styles.passBottom}>
                    <span>HỘI THẢO & SỰ KIỆN</span>
                    <span>Đăng ký · Kết nối</span>
                  </div>
                </div>
              </div>
            </div>
            <div
              className={styles.receiptPlane}
              data-sc-parallax="-1.85"
              aria-hidden="true"
            >
              <div className={styles.checkinReceipt}>
                <span className={styles.receiptIcon}>
                  <Check size={20} />
                </span>
                <div>
                  <strong>Sẵn sàng đón khách</strong>
                  <span>QR check-in & nhận diện VIP</span>
                </div>
                <ScanLine size={21} />
              </div>
            </div>
            <div className={styles.sceneCaption} aria-hidden="true">
              <span /> Một trải nghiệm liền mạch, từ trước giờ khai mạc.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.intro} aria-label="Tổng quan giải pháp">
        <div className={`${styles.container} ${styles.introInner}`} data-sc-in>
          <p>
            Bạn chăm chút nội dung.
            <br />
            <strong>Phần vận hành, đã có công cụ.</strong>
          </p>
          <div>
            <span>
              <ClipboardList size={18} /> Trước sự kiện
            </span>
            <span>
              <ScanLine size={18} /> Tại sự kiện
            </span>
            <span>
              <BarChart3 size={18} /> Sau sự kiện
            </span>
          </div>
        </div>
      </section>

      <GuestJourney reduceMotion={Boolean(reduceMotion)} />

      <section
        id="features"
        className={styles.features}
        aria-labelledby="features-heading"
        data-sc-act="flow"
      >
        <div className={styles.container}>
          <div className={styles.featuresHeading} data-sc-in>
            <h2 id="features-heading">
              Một nơi làm việc.
              <br />
              <span>Nhiều việc được gỡ nhẹ.</span>
            </h2>
            <p>
              Từ hội thảo CME đến sự kiện doanh nghiệp, chọn đúng công cụ cho
              từng khâu tổ chức.
            </p>
          </div>
          <div className={styles.capabilityList}>
            {CAPABILITIES.map(({ icon: Icon, title, text, href }) => (
              <Link
                key={title}
                href={href}
                className={styles.capability}
                data-sc-in
              >
                <Icon size={23} strokeWidth={1.5} />
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
                <ArrowUpRight size={20} />
              </Link>
            ))}
          </div>
          <div className={styles.connection}>
            <div className={styles.connectionCopy}>
              <span className={styles.connectionIcon}>
                <Heart size={23} strokeWidth={1.5} />
              </span>
              <h3>
                Để người tham dự
                <br />
                trở thành một phần sự kiện.
              </h3>
              <p>
                Gửi một lời chúc lên màn LED, cùng đội chơi hợp lực, hay tìm vị
                trí gian hàng bằng một vòng quay.
              </p>
              <div className={styles.toolLinks}>
                <Link href="/admin/tools/wish-wall">
                  Tường lời chúc <ArrowUpRight size={16} />
                </Link>
                <Link href="/admin/tools/flap">
                  Trò chơi hợp lực <ArrowUpRight size={16} />
                </Link>
                <Link href="/booth-draw">
                  Bốc thăm gian hàng <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
            <div
              className={styles.wishScene}
              data-sc-reveal="up"
              data-sc-reveal-at="0 0.35"
              role="img"
              aria-label="Minh họa những lời chúc kết nối thành hình trái tim trên màn hình sự kiện"
            >
              <div className={styles.wishDots} aria-hidden="true">
                {Array.from({ length: 32 }, (_, i) => (
                  <i key={i} style={{ "--i": i } as React.CSSProperties} />
                ))}
              </div>
              <Heart
                className={styles.wishHeart}
                size={142}
                strokeWidth={0.7}
                aria-hidden="true"
              />
              <span className={styles.wishOne}>
                Chúc một ngày thật ý nghĩa!
              </span>
              <span className={styles.wishTwo}>Cảm ơn vì đã cùng nhau.</span>
              <span className={styles.wishThree}>
                <Heart size={14} fill="currentColor" /> Kết nối những điều tốt
                đẹp
              </span>
              <span className={styles.wishCaption}>
                Minh họa tường lời chúc
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="games"
        className={styles.games}
        aria-labelledby="games-heading"
      >
        <div className={styles.container}>
          <div className={styles.gamesHeading}>
            <div>
              <p className={styles.eyebrow}>THÊM MỘT CHÚT BẤT NGỜ</p>
              <h2 id="games-heading">
                Đến tham dự.
                <br />
                <span>Ở lại vì hào hứng.</span>
              </h2>
            </div>
            <div className={styles.gamesAside}>
              <p>
                {GAME_MODULES.length} game tương tác sẵn sàng cho những khoảng
                nghỉ đầy kết nối.
              </p>
              <Link className={styles.textLink} href="/games">
                Khám phá thư viện <ArrowUpRight size={18} />
              </Link>
            </div>
          </div>
          <div
            ref={galleryRef}
            className={styles.gameRail}
            aria-label="Game nổi bật"
          >
            {FEATURED.map((game) => (
              <Link
                href={`/games/play?module=${game.id}`}
                key={game.id}
                className={styles.game}
              >
                <div className={styles.gameImage}>
                  {game.cover && (
                    <Image
                      src={game.cover}
                      alt={`Hình ảnh game ${game.name}`}
                      width={560}
                      height={380}
                      sizes="(max-width: 600px) 78vw, (max-width: 1000px) 45vw, 360px"
                    />
                  )}
                  <span className={styles.gamePlay}>
                    <ArrowUpRight size={23} />
                  </span>
                </div>
                <div className={styles.gameTitle}>
                  <h3>{game.name}</h3>
                  <Gamepad2 size={19} />
                </div>
                <p>{GAME_DESCRIPTIONS[game.id]}</p>
              </Link>
            ))}
          </div>
          <div className={styles.galleryBottom}>
            <span>Chơi thử trực tiếp trên trình duyệt</span>
            <div>
              <button
                type="button"
                aria-label="Xem game trước"
                onClick={() => moveGallery(-1)}
              >
                <ArrowLeft size={19} />
              </button>
              <button
                type="button"
                aria-label="Xem game tiếp theo"
                onClick={() => moveGallery(1)}
              >
                <ArrowRight size={19} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <div className={`${styles.container} ${styles.closingInner}`}>
          <span className={styles.closingSymbol} aria-hidden="true">
            <ArrowDownLeft size={48} strokeWidth={1} />
          </span>
          <h2 id="closing-heading">
            Sự kiện tiếp theo.
            <br />
            <span>Bắt đầu thật gọn.</span>
          </h2>
          <div>
            <p>
              Tạo biểu mẫu đầu tiên và chuẩn bị
              <br />
              một trải nghiệm đón khách chỉn chu.
            </p>
            <Link
              href={startHref}
              className={`${styles.button} ${styles.buttonDark}`}
            >
              {startLabel}
              <ArrowUpRight size={19} />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <div className={styles.footerBrand}>
            <Link href="/" className={styles.brand}>
              <QrCode size={23} />
              <span>I-solution Manager</span>
            </Link>
            <p>
              Công cụ cho người đứng sau
              <br />
              những sự kiện đáng nhớ.
            </p>
          </div>
          <div>
            <h3>Khám phá</h3>
            <a href="#how">Quy trình</a>
            <a href="#features">Giải pháp sự kiện</a>
            <Link href="/games">Thư viện game</Link>
          </div>
          <div>
            <h3>Làm việc</h3>
            <Link href="/admin">Dashboard</Link>
            <Link href="/admin/templates">Mẫu email</Link>
            <Link href="/login">Đăng nhập</Link>
          </div>
          <div className={styles.footerContact}>
            <h3>Cùng bạn tổ chức</h3>
            <a href="mailto:hotro@hoithaotructuyen.net">
              hotro@hoithaotructuyen.net <ArrowUpRight size={15} />
            </a>
            <span>Hỗ trợ qua email trong giờ làm việc</span>
          </div>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <span>© 2026 Phi Lao · I-solution Manager</span>
          <span>Đăng ký. Đón tiếp. Kết nối.</span>
        </div>
      </footer>
    </main>
  );
}
