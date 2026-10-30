"use client";

import Image from "next/image";
import { useRef, useState } from "react";
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
} from "lucide-react";
import styles from "./GuestJourney.module.css";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Đăng ký",
    text: "Một người tham dự. Một mã QR riêng.",
    caption:
      "Từ thông tin đăng ký, hành trình của mỗi khách bắt đầu bằng một mã QR.",
  },
  {
    icon: Mail,
    title: "Nhận thư mời",
    text: "QR nằm gọn trên lời mời dành riêng cho bạn.",
    caption:
      "Mã QR được đặt đúng vị trí trên thư mời, sẵn sàng theo khách đến hội thảo.",
  },
  {
    icon: ScanLine,
    title: "QR check-in",
    text: "Đưa mã vào khung. Sẵn sàng chào đón.",
    caption:
      "Từ thư mời đến màn hình quét, cùng một mã QR kết nối trọn hành trình.",
  },
];

function TravelingQr({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      layoutId="guest-journey-qr"
      className={styles.qrObject}
      data-qr-flight
      transition={{
        duration: reduceMotion ? 0 : 1.05,
        ease: [0.22, 1, 0.36, 1],
      }}
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

export function GuestJourney({ reduceMotion }: { reduceMotion: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollStage = useRef(0);
  const [stage, setStage] = useState(0);
  const [name, setName] = useState("Nguyễn Minh Anh");
  const displayName = name.trim() || "Khách tham dự";
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    if (
      reduceMotion ||
      sectionRef.current?.querySelector("input:focus") ||
      !window.matchMedia("(min-width: 1100px) and (min-height: 860px)").matches
    )
      return;
    const next = Math.min(2, Math.floor(progress * 3));
    if (next !== scrollStage.current) {
      scrollStage.current = next;
      setStage(next);
    }
  });

  const transition = {
    duration: reduceMotion ? 0 : 0.9,
    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  };

  return (
    <section
      ref={sectionRef}
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
                  onClick={() => setStage(index)}
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
                onClick={() => setStage((stage + 1) % 3)}
              >
                {stage === 0
                  ? "Xem thư mời"
                  : stage === 1
                    ? "Thử bước check-in"
                    : "Thử lại hành trình"}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <LayoutGroup id="homepage-guest-journey">
            <div
              id="journey-preview"
              className={styles.preview}
              data-stage={stage}
            >
              <div className={styles.toolbar}>
                <span>
                  <i /> Một mã QR, xuyên suốt hành trình
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
                  initial={false}
                  animate={{
                    opacity: stage === 2 ? 1 : 0.16,
                    scale: stage === 2 ? 1 : 0.88,
                    x: stage === 2 ? "0%" : "13%",
                    rotateY: stage === 2 ? 0 : -17,
                    rotateZ: stage === 2 ? 0 : 3,
                  }}
                  transition={transition}
                >
                  <Image
                    src="/landing/checkin-screen.webp"
                    alt="Ảnh giao diện quét QR do bạn cung cấp, dùng trong trải nghiệm minh họa"
                    width={1357}
                    height={868}
                    sizes="(max-width: 699px) 94vw, (max-width: 1099px) 75vw, 720px"
                    className={styles.scannerImage}
                  />
                  <div className={styles.screenInterior}>
                    <div
                      className={styles.scannerQrSlot}
                      data-qr-destination="scanner"
                    >
                      {stage === 2 && (
                        <TravelingQr reduceMotion={reduceMotion} />
                      )}
                    </div>
                    {stage === 2 && (
                      <>
                        <motion.div
                          key="scan-beam"
                          className={styles.beamRunner}
                          aria-hidden="true"
                          initial={{ opacity: 0 }}
                          animate={
                            reduceMotion
                              ? { opacity: 0 }
                              : {
                                  y: ["-42%", "42%", "-15%"],
                                  opacity: [0, 1, 0],
                                }
                          }
                          transition={{
                            duration: 1.35,
                            delay: 0.2,
                            ease: "easeInOut",
                          }}
                        >
                          <span />
                        </motion.div>
                        <motion.div
                          key="scan-success"
                          className={styles.success}
                          initial={{
                            opacity: 0,
                            scale: reduceMotion ? 1 : 0.95,
                            y: reduceMotion ? 0 : 10,
                          }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{
                            ...transition,
                            duration: reduceMotion ? 0 : 0.45,
                            delay: reduceMotion ? 0 : 1.3,
                          }}
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
                            <Check size={13} /> Xác nhận minh họa
                          </span>
                        </motion.div>
                      </>
                    )}
                  </div>
                </motion.div>

                <motion.div
                  className={styles.invitationLayer}
                  initial={false}
                  animate={{
                    opacity: stage === 0 ? 0.32 : stage === 1 ? 1 : 0,
                    x: stage === 2 ? "-48%" : "0%",
                    y: stage === 2 ? "-6%" : "0%",
                    scale: stage === 0 ? 0.93 : stage === 1 ? 1 : 0.57,
                    rotateZ: stage === 0 ? -9 : stage === 1 ? 0 : -13,
                    rotateY: stage === 2 ? -10 : 0,
                  }}
                  transition={transition}
                >
                  <div className={styles.invitationPaper}>
                    <Image
                      src="/landing/conference-invitation.webp"
                      alt="Mẫu thư mời Hội nghị Tim mạch Toàn diện 2026 với ô QR ở góc trái phía dưới"
                      width={1054}
                      height={1493}
                      sizes="(max-width: 699px) 60vw, (max-width: 1099px) 40vw, 380px"
                    />
                    <div
                      className={styles.invitationQrSlot}
                      data-qr-destination="invitation"
                    >
                      {stage === 1 && (
                        <TravelingQr reduceMotion={reduceMotion} />
                      )}
                    </div>
                  </div>
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
                    {stage === 0
                      ? "Được tạo từ đăng ký"
                      : stage === 1
                        ? "Được đặt trên lời mời"
                        : "Được nhận diện tại sự kiện"}
                  </span>
                  <span className={styles.stateMarks}>
                    {STEPS.map((step, index) => (
                      <i
                        key={step.title}
                        className={index <= stage ? styles.markDone : ""}
                      />
                    ))}
                  </span>
                </div>
              </div>
              <div className={styles.sceneCaption}>
                <span className={styles.captionIcon}>
                  {stage === 2 ? <ScanLine size={18} /> : <QrCode size={18} />}
                </span>
                <div>
                  <strong>{displayName}</strong>
                  <p>{STEPS[stage].caption}</p>
                </div>
              </div>
            </div>
          </LayoutGroup>
        </div>
        <p className={styles.disclosure}>
          Ảnh thư mời và giao diện minh họa. Không gửi thư, không ghi nhận điểm
          danh thực tế.
        </p>
      </div>
    </section>
  );
}
