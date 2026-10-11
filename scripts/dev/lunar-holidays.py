# 설날, 추석 표(src/shared/lunar-holidays.ts)를 다시 만드는 법. 앱은 이 파일을 쓰지 않는다.
#   pip install --target /tmp/eph ephem && PYTHONPATH=/tmp/eph python3 scripts/dev/lunar-holidays.py
# 한국 음력 규칙: 한국 표준시(UTC+9) 날짜로 합삭이 든 날이 초하루, 동지가 든 달이 11월,
# 13달인 해는 중기가 없는 첫 달이 윤달. 2025~2050 은 korean-lunar-calendar(천문연 자료)와 같다.
import datetime, math
import ephem
KST = 9/24
def kst_date(d):  # ephem.Date (UT days) -> python date in KST
    return (ephem.Date(d + KST)).datetime().date()
def sun_lon(d):
    s = ephem.Sun(); s.compute(ephem.Date(d), epoch=ephem.Date(d))
    return math.degrees(ephem.Ecliptic(s, epoch=ephem.Date(d)).lon)
def term_time(deg, near):  # time near 'near' when apparent solar longitude == deg
    d = ephem.Date(near)
    for _ in range(60):
        diff = ((deg - sun_lon(d) + 180) % 360) - 180
        if abs(diff) < 1e-7: break
        d = ephem.Date(d + diff / 360 * 365.2422)
    return d
def solstice(y): return term_time(270, ephem.Date(f'{y}/12/21'))
def new_moons(a, b):
    out = []; d = ephem.previous_new_moon(a)
    while d < b + 40:
        out.append(d); d = ephem.next_new_moon(ephem.Date(d + 1))
    return out
def zhongqi_dates(a, b):  # KST dates of principal terms (multiples of 30 deg) between a and b
    res = []
    for k in range(12):
        deg = k * 30
        # find all near times
        d = ephem.Date(a)
        while d < b + 31:
            t = term_time(deg, d)
            res.append(kst_date(t)); d = ephem.Date(d + 365.2422)
    return set(res)
def month11_start(y):  # KST date of new moon starting month containing WS of year y
    ws = kst_date(solstice(y))
    nms = [kst_date(n) for n in new_moons(ephem.Date(f'{y}/11/1'), ephem.Date(f'{y}/12/31'))]
    return max(n for n in nms if n <= ws)
def months(y):  # list of (label, leap, start date) for sui from month11 of y-1 to month11 of y
    a = month11_start(y-1); b = month11_start(y)
    nms = sorted(set(kst_date(n) for n in new_moons(ephem.Date(a.strftime('%Y/%m/%d')) , ephem.Date(b.strftime('%Y/%m/%d')))))
    nms = [n for n in nms if a <= n <= b]
    assert nms[0] == a and nms[-1] == b, (y, nms[0], a, nms[-1], b)
    starts = nms[:-1]
    zq = zhongqi_dates(ephem.Date(a.strftime('%Y/%m/%d')) - 30, ephem.Date(b.strftime('%Y/%m/%d')))
    leap_i = None
    if len(starts) == 13:
        for i in range(len(starts)):
            end = nms[i+1]
            if not any(starts[i] <= z < end for z in zq):
                leap_i = i; break
    out = []; label = 11
    for i, s in enumerate(starts):
        if i == leap_i:
            out.append((label, True, s)); continue
        if i > 0: label = label % 12 + 1
        out.append((label, False, s))
    return out
res = {}
for y in range(2025, 2101):
    ms = months(y) + months(y+1)
    seol = next(s for (l, lp, s) in ms if l == 1 and not lp and s.year == y)
    ch = next(s for (l, lp, s) in ms if l == 8 and not lp and s.year == y) + datetime.timedelta(days=14)
    res[y] = (seol, ch)
    print(y, seol, ch)
