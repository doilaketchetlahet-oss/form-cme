"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  LayoutGroup,
  motion,
  useMotionValueEvent,
  useScroll,
} from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ClipboardList,
  Mail,
  QrCode,
  ScanLine,
  Smartphone,
} from "lucide-react";
import styles from "./GuestJourney.module.css";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Đăng ký",
    text: "Một người tham dự. Một mã QR riêng.",
    caption:
      "Từ thông tin đăng ký, hành trình của mỗi khách bắt đầu bằng một mã QR.",
    next: "Xem thư mời",
  },
  {
    icon: Mail,
    title: "Nhận thư mời",
    text: "QR nằm gọn trên lời mời dành riêng cho bạn.",
    caption:
      "Mã QR được đặt đúng vị trí trên thư mời, sẵn sàng theo khách đến hội thảo.",
    next: "Mở trên điện thoại",
  },
  {
    icon: Smartphone,
    title: "Mang theo QR",
    text: "Thư mời nằm trong tay, sẵn sàng đến sự kiện.",
    caption: "Lưu thư mời trên điện thoại, mang theo cùng mã QR của riêng bạn.",
    next: "Thử bước check-in",
  },
  {
    icon: ScanLine,
    title: "QR check-in",
    text: "Đưa điện thoại vào khung. Sẵn sàng chào đón.",
    caption:
      "Đưa QR trên điện thoại tới màn hình quét, nhận lời chào tại sự kiện.",
    next: "Thử lại hành trình",
  },
];
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

function TravelingQr({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      layoutId="guest-journey-qr"
      className={styles.qrObject}
      data-qr-flight
      transition={{ duration: reduceMotion ? 0 : 1.05, ease: EASE }}
    >
      <Image
        src="/landing/guest-pass.svg"
        alt="QR minh họa, không dùng để check-in thực tế"
        width={180}
        height={180}
      />
    </motion.div>
  );
}

function Invitation({
  destination,
  reduceMotion,
  qr,
}: {
  destination: "invitation" | "phone-invitation";
  reduceMotion: boolean;
  qr: boolean;
}) {
  return (
    <motion.div
      layoutId="guest-journey-invitation"
      className={styles.invitationPaper}
      data-invitation-art
      transition={{ duration: reduceMotion ? 0 : 1.1, ease: EASE }}
    >
      <Image
        src="/landing/conference-invitation.webp"
        alt="Mẫu thư mời Hội nghị Tim mạch Toàn diện 2026 với ô QR ở góc trái phía dưới"
        width={1054}
        height={1493}
        sizes="(max-width: 699px) 65vw, 380px"
      />
      <div
        className={styles.invitationQrSlot}
        data-qr-destination={destination}
      >
        {qr && <TravelingQr reduceMotion={reduceMotion} />}
      </div>
    </motion.div>
  );
}

export function GuestJourney({ reduceMotion }: { reduceMotion: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollStage = useRef(-1);
  const navigateUntil = useRef(0);
  const [stage, setStage] = useState(0);
  const [scanned, setScanned] = useState(false);
  const [name, setName] = useState("Nguyễn Minh Anh");
  const displayName = name.trim() || "Khách tham dự";
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start 15%", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    if (
      reduceMotion ||
      document.activeElement === inputRef.current ||
      performance.now() < navigateUntil.current
    )
      return;
    const next = Math.min(3, Math.floor(progress * 4));
    if (next !== scrollStage.current) {
      scrollStage.current = next;
      selectStage(next);
    }
  });

  useEffect(() => {
    if (stage !== 3) return;
    const timer = window.setTimeout(
      () => setScanned(true),
      reduceMotion ? 0 : 1900,
    );
    return () => window.clearTimeout(timer);
  }, [stage, reduceMotion]);

  function selectStage(next: number) {
    if (next === stage) return;
    setScanned(false);
    setStage(next);
  }
  function goToStage(next: number) {
    selectStage(next);
    const track = trackRef.current;
    if (reduceMotion || !track) {
      return;
    }
    // Keep native smooth-scroll navigation from replaying intermediate button states.
    navigateUntil.current = performance.now() + 1000;
    scrollStage.current = -1;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const start = top - window.innerHeight * 0.15;
    const end = top + track.offsetHeight - window.innerHeight;
    window.scrollTo({
      top: start + Math.max(1, end - start) * ((next + 0.5) / STEPS.length),
      behavior: "smooth",
    });
  }
  // Scroll can also leave the scan stage. Derive its visible success from both values.
  const success = stage === 3 && scanned;
  const transition = { duration: reduceMotion ? 0 : 1.1, ease: EASE };

  return (
    <section
      id="how"
      className={styles.journey}
      aria-labelledby="journey-heading"
    >
      <div className={styles.stickyStage}>
        <div className={styles.heading}>
          <h2 id="journey-heading">
            Một mã QR.
            <br />
            <span>Đi cùng từng khoảnh khắc.</span>
          </h2>
          <p>
            Từ lời mời trên tay
            <br />
            đến lời chào tại sự kiện.
          </p>
        </div>
        <div className={styles.experience}>
          <div className={styles.desk}>
            <div className={styles.steps} aria-label="Các bước minh họa">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <button
                  type="button"
                  key={title}
                  className={`${styles.step} ${stage === index ? styles.activeStep : ""}`}
                  onClick={() => goToStage(index)}
                  aria-pressed={stage === index}
                  aria-controls="journey-preview"
                >
                  <span className={styles.stepIcon}>
                    <Icon size={21} strokeWidth={1.6} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
            <div className={styles.personalize}>
              <label htmlFor="demo-guest-name">Thử với tên của bạn</label>
              <input
                ref={inputRef}
                id="demo-guest-name"
                aria-label="Tên khách minh họa"
                value={name}
                maxLength={60}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="button"
                className={styles.next}
                onClick={() => goToStage((stage + 1) % 4)}
              >
                {STEPS[stage].next}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div ref={trackRef} className={styles.visualTrack} data-journey-track>
            <div className={styles.visualSticky}>
              <LayoutGroup id="homepage-guest-journey">
                <div
                  id="journey-preview"
                  className={styles.preview}
                  data-stage={stage}
                  data-scanned={success}
                >
                  <div className={styles.toolbar}>
                    <span>
                      <i />
                      Một mã QR, xuyên suốt hành trình
                    </span>
                    <span>TRẢI NGHIỆM MINH HỌA</span>
                  </div>
                  <div className={styles.space}>
                    <div className={styles.orbits} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                    <motion.div
                      className={styles.scannerLayer}
                      data-scanner-layer
                      initial={false}
                      animate={{
                        opacity: stage === 3 ? 1 : 0.12,
                        scale: stage === 3 ? 1 : 0.88,
                        x: stage === 3 ? "0%" : "13%",
                        rotateY: stage === 3 ? 0 : -17,
                        rotateZ: stage === 3 ? 0 : 3,
                      }}
                      transition={transition}
                    >
                      <Image
                        src="/landing/checkin-screen.webp"
                        alt="Giao diện quét QR trong trải nghiệm minh họa"
                        width={1357}
                        height={868}
                        sizes="(max-width: 699px) 94vw, 800px"
                        className={styles.scannerImage}
                      />
                      <div
                        className={styles.screenInterior}
                        data-scanner-interior
                      >
                        {stage === 3 && !reduceMotion && (
                          <motion.div
                            key="scan-beam"
                            className={styles.beamRunner}
                            aria-hidden="true"
                            initial={{ opacity: 0 }}
                            animate={{
                              y: ["-42%", "42%", "-15%"],
                              opacity: [0, 1, 0],
                            }}
                            transition={{
                              duration: 1.45,
                              delay: 0.45,
                              ease: "easeInOut",
                            }}
                          >
                            <span />
                          </motion.div>
                        )}
                        {success && (
                          <motion.div
                            key="scan-success"
                            className={styles.success}
                            initial={{
                              opacity: 0,
                              scale: reduceMotion ? 1 : 0.95,
                            }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: reduceMotion ? 0 : 0.45 }}
                          >
                            <span className={styles.successIcon}>
                              <CheckCheck size={32} strokeWidth={1.6} />
                            </span>
                            <span className={styles.successLabel}>
                              ĐÃ NHẬN DIỆN MÃ QR
                            </span>
                            <h3>Chào {displayName}!</h3>
                            <p>Rất vui được đón bạn tại hội thảo.</p>
                            <span className={styles.successNote}>
                              <Check size={13} />
                              Xác nhận minh họa
                            </span>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                    {stage < 2 && (
                      <motion.div
                        className={styles.invitationLayer}
                        initial={false}
                        animate={{
                          opacity: stage === 0 ? 0.32 : 1,
                          scale: stage === 0 ? 0.93 : 1,
                          rotateZ: stage === 0 ? -9 : 0,
                        }}
                        transition={transition}
                      >
                        <Invitation
                          destination="invitation"
                          reduceMotion={reduceMotion}
                          qr={stage === 1}
                        />
                      </motion.div>
                    )}
                    <motion.div
                      className={styles.phoneLayer}
                      data-phone-layer
                      initial={false}
                      animate={{
                        opacity: stage >= 2 ? 1 : 0,
                        x:
                          stage < 2
                            ? "65%"
                            : success
                              ? "var(--phone-retreat)"
                              : stage === 3
                                ? "12%"
                                : "0%",
                        y: stage < 2 ? "75%" : success ? "25%" : "0%",
                        scale: success ? 0.68 : 1,
                        rotateZ: success ? 9 : stage === 3 ? 0 : -6,
                      }}
                      transition={transition}
                    >
                      <div className={styles.phoneScreen} data-phone-screen>
                        {stage === 2 && (
                          <div className={styles.phoneInvitation}>
                            <Invitation
                              destination="phone-invitation"
                              reduceMotion={reduceMotion}
                              qr
                            />
                          </div>
                        )}
                        {stage === 3 && (
                          <div className={styles.phoneScanPass}>
                            <span>THẺ THAM DỰ</span>
                            <strong>{displayName}</strong>
                            <div
                              className={styles.phoneScanSlot}
                              data-qr-destination="phone-scan"
                            >
                              <TravelingQr reduceMotion={reduceMotion} />
                            </div>
                            <span>Một mã QR. Trọn hành trình.</span>
                          </div>
                        )}
                      </div>
                      <Image
                        className={styles.phoneHand}
                        src="/landing/hand-phone.webp"
                        alt="Bàn tay cầm điện thoại đưa thư mời và QR tới khung quét"
                        width={1200}
                        height={1200}
                        sizes="(max-width: 699px) 600px, 720px"
                      />
                    </motion.div>
                    {stage === 0 && (
                      <div
                        className={styles.sourceDock}
                        data-qr-destination="registration"
                      >
                        <TravelingQr reduceMotion={reduceMotion} />
                        <span className={styles.sourceCaption}>
                          CỦA RIÊNG BẠN
                          <ArrowRight size={15} />
                        </span>
                      </div>
                    )}
                    <div className={styles.sceneFoot} aria-hidden="true">
                      <span>
                        {
                          [
                            "Được tạo từ đăng ký",
                            "Được đặt trên lời mời",
                            "Nằm gọn trong tay bạn",
                            "Được nhận diện tại sự kiện",
                          ][stage]
                        }
                      </span>
                      <span className={styles.stateMarks}>
                        {STEPS.map((s, i) => (
                          <i
                            key={s.title}
                            className={i <= stage ? styles.markDone : ""}
                          />
                        ))}
                      </span>
                    </div>
                  </div>
                  <div className={styles.sceneCaption}>
                    <span className={styles.captionIcon}>
                      {stage === 3 ? (
                        <ScanLine size={18} />
                      ) : (
                        <QrCode size={18} />
                      )}
                    </span>
                    <div>
                      <strong>{displayName}</strong>
                      <p>{STEPS[stage].caption}</p>
                    </div>
                  </div>
                </div>
              </LayoutGroup>
            </div>
          </div>
        </div>
        <p className={styles.disclosure}>
          Ảnh thư mời và giao diện minh họa. Không gửi thư, không ghi nhận điểm
          danh thực tế.
        </p>
      </div>
    </section>
  );
}
