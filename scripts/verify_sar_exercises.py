#!/usr/bin/env python3
"""Verify all exercise answers from '1. S 2026 INTRO TO SAR CALCULATION.pdf'
before embedding them into the Penghitungan Dasar tab."""

def hms(hours: float):
    h = int(hours)
    m_float = (hours - h) * 60
    m = int(m_float)
    s = round((m_float - m) * 60)
    if s == 60:
        s = 0
        m += 1
    if m == 60:
        m = 0
        h += 1
    return h, m, s

def show(label, val):
    print(f"{label}: {val}")

print("=== WAKTU: desimal -> jam menit detik ===")
for x in (1.68, 3.12, 0.735, 9.54, 5.86):
    show(f"{x} jam", hms(x))

print("\n=== WAKTU: jam menit detik -> desimal ===")
def dec(h=0, m=0, s=0): return h + m/60 + s/3600
for lbl, (h, m, s) in {
    "3j12m18s": (3,12,18), "24m58s": (0,24,58),
    "48m36s": (0,48,36), "7j24m54s": (7,24,54),
    "5j51m36s": (5,51,36),
}.items():
    show(lbl, round(dec(h,m,s), 6))

print("\n=== ZONA WAKTU ===")
def tz(t, offset):
    return (t + offset) % 24
show("1600 UTC -> WITA(+8)", tz(1600//100, 8))          # Ashmore Reef -> Kupang
show("0000 UTC -> WITA(+8)", tz(0, 8))                  # MV Grace -> Ternate
show("2000 WIB -> UTC(-7)", tz(20, -7))                 # MV Pacific Ocean
show("0300 WIB -> UTC(-7)", tz(3, -7))                  # MV Sydney Line

print("\n=== KONVERSI KECEPATAN ===")
show("75 kts -> km/jam", 75*1.852)
show("20 cm/s -> km/jam", 20*0.036)
show("27 cm/s -> km/jam", 27*0.036)
show("27 cm/s -> kts", 27*0.019438444)

print("\n=== SVT LATIHAN ===")
show("L1 S = 75kts*3jam", 75*3)                          # 225 nm
show("L2 T = 63/21", 63/21)                              # 3 jam
show("L3 V = 396/4.5", 396/4.5)                          # 88 km/jam
show("L4 S = 18*3 + 15*1", 18*3+15*1)                    # 69 nm
t5 = 78/30; show("L5 T = 78/30 (jam)", t5); show("L5 hms", hms(t5))
show("L6 V = 125/1.25", 125/1.25)                        # 100 km/jam
t7 = 10*24+5; show("L7 T(hrs)=10h5j", t7); show("L7 S = 11*245", 11*t7)
t1 = 1485/550; t2 = (2485-1485)/500
show("L8 t1=1485/550", t1); show("L8 t2=1000/500", t2)
show("L8 total jam", t1+t2); show("L8 hms", hms(t1+t2))

print("\n=== AREA LATIHAN ===")
show("L1 A = 4*120*1", 4*120*1)                          # 480 nm2
t = 22980/(120*1); show("L2 T = 22980/120", t); show("L2 hms", hms(t))
show("L3 n = 2880/(3*120*1)", 2880/(3*120*1))            # 8
show("L4 A = 3*120*6*5", 3*120*6*5)                      # 10800 nm2
show("L5 pct = 10800/22980", 10800/22980*100)            # 47%
show("L6 A = (3*120+180+90+100)*3*5", (3*120+180+90+100)*3*5)
show("L7 S = 2970/(4.5*120)", 2970/(4.5*120))            # 5.5 nm
n8 = 2300/(2*120*2); show("L8 n = 2300/(2*120*2)", n8)   # 4.79 -> 5 pesawat
a9 = 24*33; swept = 4*12*6
show("L9 A_total = 24*33", a9); show("L9 swept", swept)
show("L9 pct", swept/a9*100)                             # 36.36%
show("L10 n = 560/(7*10*5)", 560/(7*10*5))               # 1.6 -> 2
a11 = 33*16; t11 = a11/((9+11)*4)
show("L11 A = 33*16", a11); show("L11 T", t11); show("L11 hms", hms(t11))
t12 = 3000/(120*2); show("L12 T", t12); show("L12 hms", hms(t12))
v13 = (20*30)/(2*2); show("L13 V = 600/4", v13)          # 150 kts
a14 = 23*17; t14 = a14/(3*12)
show("L14 A = 23*17", a14); show("L14 T", t14); show("L14 hms", hms(t14))
