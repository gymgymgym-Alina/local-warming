const MODELS = ["CanESM5", "GFDL-ESM4", "IPSL-CM6A-LR", "MRI-ESM2-0"];
const SCEN_LABEL = { ssp126: "SSP1-2.6", ssp585: "SSP5-8.5" };
const state = { year: 2095, scenario: "ssp585", city: "San Diego", models: new Set(MODELS) };

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ramp = () => d3.scaleSequential(
  d3.interpolateRgbBasis([css("--ramp-0"), css("--ramp-1"), css("--ramp-2"), css("--ramp-3"), css("--ramp-4")])
);
const seriesColor = i => css(`--series-${i}`);

const tipEl = d3.select("#tip");
const showTip = (ev, html) => tipEl.html(html).classed("on", true)
  .style("left", Math.min(ev.clientX + 14, innerWidth - 190) + "px")
  .style("top", Math.max(ev.clientY - 14, 8) + "px");
const hideTip = () => tipEl.classed("on", false);

let D = {};

function prepare(rows, world) {
  const mean = new Map();
  for (const [c, byScen] of d3.group(rows, d => d.city))
    for (const [s, byYear] of d3.group(byScen, d => d.scenario))
      for (const [y, v] of d3.group(byYear, d => d.year))
        mean.set(`${c}|${s}|${y}`, d3.mean(v, d => d.warming_c));

  const byModel = new Map(rows.map(d => [`${d.city}|${d.model}|${d.scenario}|${d.year}`, d.warming_c]));

  const cities = Array.from(d3.group(rows, d => d.city), ([city, v]) => ({
    city, country: v[0].country, lat: v[0].lat, lon: v[0].lon
  }));

  const endCentury = c => d3.mean(d3.range(2090, 2101), y => mean.get(`${c}|ssp585|${y}`));
  cities.forEach(c => { c.end = endCentury(c.city); });
  cities.sort((a, b) => d3.descending(a.end, b.end));

  const years = d3.extent(rows, d => d.year);
  const globalMean = new Map();
  for (const s of ["historical", "ssp126", "ssp585"])
    for (let y = years[0]; y <= years[1]; y++) {
      const vals = cities.map(c => mean.get(`${c.city}|${s}|${y}`)).filter(v => v != null);
      if (vals.length) globalMean.set(`${s}|${y}`, d3.mean(vals));
    }

  const avg = (c, scen, y0, y1) => d3.mean(
    rows.filter(r => r.city === c && r.scenario === scen && r.year >= y0 && r.year <= y1),
    r => r.temp_c);

  cities.forEach(c => {
    c.today = avg(c.city, "historical", 1981, 2010);
    c.future = avg(c.city, "ssp585", 2090, 2100);
  });

  const NO_MATCH = 1.0;
  cities.forEach(c => {
    let best = null;
    for (const o of cities) {
      if (o.city === c.city) continue;
      const err = Math.abs(o.today - c.future);
      if (!best || err < best.err) best = { city: o, err };
    }
    c.twin = best.city;
    c.twinErr = best.err;
    c.noMatch = best.err > NO_MATCH;
    c.hotter = c.future > d3.max(cities.filter(o => o.city !== c.city), o => o.today);
  });

  D = { rows, world, mean, byModel, cities, years, globalMean };
}

const at = (city, scen, year) => D.mean.get(`${city}|${year <= 2014 ? "historical" : scen}|${year}`);

function path(city, scen, model) {
  const out = [];
  for (let y = D.years[0]; y <= D.years[1]; y++) {
    const s = y <= 2014 ? "historical" : scen;
    const v = model
      ? D.byModel.get(`${city}|${model}|${s}|${y}`)
      : (city ? D.mean.get(`${city}|${s}|${y}`) : D.globalMean.get(`${s}|${y}`));
    if (v != null) out.push({ x: y, y: v });
  }
  return out;
}

function frame(sel, height) {
  const el = d3.select(sel);
  el.selectAll("*").remove();
  const w = el.node().getBoundingClientRect().width || 640;
  return { svg: el.append("svg").attr("viewBox", `0 0 ${w} ${height}`), w, h: height };
}

function legend(sel, items, onToggle) {
  const el = d3.select(sel).html("");
  const tag = onToggle ? "button" : "span";
  el.selectAll(tag).data(items).join(tag)
    .attr("class", d => onToggle ? "toggle" + (d.on ? "" : " is-off") : null)
    .attr("type", onToggle ? "button" : null)
    .attr("aria-pressed", d => onToggle ? String(!!d.on) : null)
    .html(d => `<i style="background:${d.on === false ? "transparent" : d.color};box-shadow:inset 0 0 0 2px ${d.color}"></i>${d.name}`)
    .on("click", onToggle ? (ev, d) => onToggle(d.name) : null);
}

function lineChart(sel, height, series, { yLabel, xDomain, yDomain, pad = { t: 24, r: 76, b: 32, l: 46 } }) {
  const { svg, w } = frame(sel, height);
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const g = svg.append("g").attr("transform", `translate(${pad.l},${pad.t})`);
  const all = series.flatMap(s => s.values);
  if (!all.length) return;

  const x = d3.scaleLinear().domain(xDomain || d3.extent(all, d => d.x)).range([0, iw]);
  const y = d3.scaleLinear().domain(yDomain || d3.extent(all, d => d.y)).nice().range([ih, 0]);

  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "°"));
  g.append("text").attr("class", "mark-label").attr("y", -10).text(yLabel);

  const line = d3.line().x(d => x(d.x)).y(d => y(d.y));

  g.selectAll("path.s").data(series).join("path")
    .attr("class", "s").attr("fill", "none")
    .attr("stroke", d => d.color).attr("stroke-width", 2)
    .attr("stroke-dasharray", d => d.dash || null)
    .attr("d", d => line(d.values));

  const labeled = series.filter(s => s.label !== false)
    .map(s => ({ s, ly: y(s.values.at(-1).y), ty: y(s.values.at(-1).y) }))
    .sort((a, b) => a.ty - b.ty);
  const GAP = 13;
  for (let i = 1; i < labeled.length; i++)
    labeled[i].ty = Math.max(labeled[i].ty, labeled[i - 1].ty + GAP);
  const over = labeled.length ? labeled.at(-1).ty - ih : 0;
  if (over > 0) labeled.forEach(d => { d.ty -= over; });

  const ends = g.selectAll("g.end").data(labeled).join("g").attr("class", "end");
  ends.filter(d => Math.abs(d.ty - d.ly) > 2).append("polyline")
    .attr("class", "note-line")
    .attr("stroke", d => d.s.color)
    .attr("stroke-width", 0.8)
    .attr("opacity", 0.55)
    .attr("points", d => `${iw},${d.ly} ${iw + 3},${d.ly} ${iw + 3},${d.ty} ${iw + 5},${d.ty}`);
  ends.append("text")
    .attr("class", "mark-label")
    .attr("x", iw + 7)
    .attr("y", d => d.ty + 4)
    .attr("fill", d => d.s.color)
    .text(d => d.s.name);

  const rule = g.append("line").attr("class", "note-line").attr("y1", 0).attr("y2", ih).style("opacity", 0);
  const dots = g.append("g");
  const bisect = d3.bisector(d => d.x).center;

  g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "none").attr("pointer-events", "all")
    .on("mousemove", ev => {
      const xv = Math.round(x.invert(d3.pointer(ev)[0]));
      rule.style("opacity", 1).attr("x1", x(xv)).attr("x2", x(xv));
      const hits = series.map(s => {
        const p = s.values[bisect(s.values, xv)];
        return p && Math.abs(p.x - xv) <= 1 ? { s, p } : null;
      }).filter(Boolean);
      dots.selectAll("circle").data(hits).join("circle")
        .attr("r", 4).attr("cx", d => x(d.p.x)).attr("cy", d => y(d.p.y))
        .attr("fill", d => d.s.color).attr("stroke", css("--surface")).attr("stroke-width", 2);
      showTip(ev, `<b>${xv}</b><br>` + hits.map(d =>
        `${d.s.name} <b>${d.p.y.toFixed(2)}°</b>`).join("<br>"));
    })
    .on("mouseleave", () => { hideTip(); rule.style("opacity", 0); dots.selectAll("circle").remove(); });
}

function twinChart() {
  const c = D.cities.find(d => d.city === state.city);
  const t = c.twin;
  const f = d3.format(".1f");

  const headline = !c.noMatch
    ? `By 2100, <b>${c.city}</b> will feel like <b>${t.city}</b> does today.`
    : c.hotter
      ? `By 2100, <b>${c.city}</b> will be hotter than any city on this map is today.`
      : `By 2100, <b>${c.city}</b> lands between the cities on this map.`;

  const stem = `${c.city} averages ${f(c.today)}\u00B0C today and ${f(c.future)}\u00B0C by the end of the century.`;
  const detail = !c.noMatch
    ? `${stem} ${t.city} averages ${f(t.today)}\u00B0C today.`
    : c.hotter
      ? `${stem} The closest city here is ${t.city}, and it is still ${f(c.twinErr)} degrees cooler than that.`
      : `${stem} No city here is close, the nearest being ${t.city}, ${f(c.twinErr)} degrees away.`;

  d3.select("#twin-line").html(headline);
  d3.select("#twin-detail").html(detail);

  const height = 360;
  const { svg, w } = frame("#chart-twin", height);
  const land = { type: "FeatureCollection", features: D.world.features };
  const proj = d3.geoNaturalEarth1().fitExtent([[8, 12], [w - 8, height - 12]], land);

  svg.append("g").selectAll("path").data(land.features).join("path")
    .attr("class", "land").attr("d", d3.geoPath(proj));

  const warm = css("--ramp-3");
  const cool = css("--series-1");
  const a = proj([c.lon, c.lat]);
  const b = proj([t.lon, t.lat]);

  if (!c.noMatch) {
    const lift = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.3;
    svg.append("path")
      .attr("class", "twin-arc")
      .attr("d", `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2 - lift} ${b[0]},${b[1]}`)
      .attr("stroke", warm);

    const pin = svg.append("g");
    pin.append("circle").attr("class", "twin-dot")
      .attr("cx", b[0]).attr("cy", b[1]).attr("r", 7).attr("fill", cool);
    pin.append("text").attr("class", "twin-label")
      .attr("x", b[0]).attr("y", b[1] + 22).attr("text-anchor", "middle")
      .attr("fill", cool)
      .text(`${t.city} today, ${f(t.today)}\u00B0`);
  }

  const here = svg.append("g");
  here.append("circle").attr("class", "twin-dot")
    .attr("cx", a[0]).attr("cy", a[1]).attr("r", 8).attr("fill", warm);
  here.append("text").attr("class", "twin-label")
    .attr("x", a[0]).attr("y", a[1] - 15).attr("text-anchor", "middle")
    .attr("fill", warm)
    .text(`${c.city} in 2100, ${f(c.future)}\u00B0`);

  if (c.noMatch) {
    svg.append("text").attr("class", "twin-label")
      .attr("x", a[0]).attr("y", a[1] + 24).attr("text-anchor", "middle")
      .attr("fill", css("--ink-2"))
      .text(c.hotter ? "no city here is that hot today" : "no close match on this map");
  }
}

function rankChart() {
  const height = D.cities.length * 17 + 56;
  const { svg, w } = frame("#chart-rank", height);
  const pad = { t: 26, r: 46, b: 26, l: 104 };
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const g = svg.append("g").attr("transform", `translate(${pad.l},${pad.t})`);

  const x = d3.scaleLinear().domain([0, d3.max(D.cities, d => d.end)]).nice().range([0, iw]);
  const y = d3.scaleBand(D.cities.map(d => d.city), [0, ih]).padding(0.35);
  const color = ramp().domain([0, d3.max(D.cities, d => d.end)]);

  g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => d + "°"));
  g.append("text").attr("class", "mark-label").attr("y", -10).text("Warming by 2090 to 2100, SSP5-8.5");

  const row = g.selectAll("g.row").data(D.cities).join("g").attr("class", "row")
    .attr("transform", d => `translate(0,${y(d.city) + y.bandwidth() / 2})`)
    .style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(ev, `<b>${d.city}</b>, ${d.country}<br>warming <b>${d.end.toFixed(2)}°</b>`))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { state.city = d.city; d3.select("#twin-pick").property("value", d.city); draw(); });

  row.append("line").attr("x1", 0).attr("x2", d => x(d.end))
    .attr("stroke", "var(--grid)").attr("stroke-width", 2).attr("stroke-linecap", "round");
  row.append("circle").attr("cx", d => x(d.end)).attr("r", 5)
    .attr("fill", d => color(d.end)).attr("stroke", css("--surface")).attr("stroke-width", 1.5);
  row.append("text").attr("class", "mark-label").attr("x", d => x(d.end) + 10).attr("dy", "0.33em")
    .text(d => d.end.toFixed(1));
}

function mapChart() {
  const land = { type: "FeatureCollection", features: D.world.features };
  // size the map to the land's own shape so there is no empty band above or below it
  const boxW = d3.select("#chart-map").node().getBoundingClientRect().width || 640;
  const fit = d3.geoNaturalEarth1().fitWidth(boxW - 12, land);
  const [[, y0], [, y1]] = d3.geoPath(fit).bounds(land);
  const height = Math.ceil(y1 - y0) + 20;
  const { svg, w } = frame("#chart-map", height);
  const proj = d3.geoNaturalEarth1().fitExtent([[6, 10], [w - 6, height - 10]], land);
  const geo = d3.geoPath(proj);
  const max = d3.max(D.cities, d => d.end);
  const color = ramp().domain([0, max]);

  svg.append("g").selectAll("path").data(land.features).join("path")
    .attr("class", "land").attr("d", geo);

  const pts = D.cities.map(c => ({ ...c, v: at(c.city, state.scenario, state.year), p: proj([c.lon, c.lat]) }))
    .filter(c => c.p && c.v != null);

  svg.append("g").selectAll("circle").data(pts, d => d.city).join("circle")
    .attr("class", d => "city" + (d.city === state.city ? " is-selected" : ""))
    .attr("cx", d => d.p[0]).attr("cy", d => d.p[1]).attr("r", 6)
    .attr("fill", d => color(d.v))
    .on("mousemove", (ev, d) => showTip(ev,
      `<b>${d.city}</b>, ${d.country}<br>${state.year} <b>${d.v.toFixed(2)}°</b> warmer`))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { state.city = d.city; d3.select("#twin-pick").property("value", d.city); draw(); });

  const stops = d3.range(0, 6).map(i => i * max / 5);
  legend("#legend-map", stops.map(v => ({ name: v.toFixed(1) + "°", color: color(v) })));
}

function draw() {
  twinChart();
  rankChart();

  lineChart("#chart-paths", 320, [
    { name: "SSP5-8.5", color: seriesColor(2), values: path(null, "ssp585") },
    { name: "SSP1-2.6", color: seriesColor(1), values: path(null, "ssp126") }
  ], { yLabel: "Mean warming across 30 cities" });
  legend("#legend-paths", [
    { name: "SSP5-8.5 high emissions", color: seriesColor(2) },
    { name: "SSP1-2.6 low emissions", color: seriesColor(1) }
  ]);

  mapChart();

  lineChart("#chart-city", 300, [
    { name: state.city, color: seriesColor(2), values: path(state.city, "ssp585") },
    { name: state.city, color: seriesColor(1), values: path(state.city, "ssp126"), label: false },
    { name: "30-city mean", color: css("--muted"), dash: "4 3", values: path(null, "ssp585") }
  ], { yLabel: `${state.city}, both pathways` });

  const allModels = MODELS.map((m, i) => ({
    name: m, color: seriesColor(i + 1), values: path(state.city, "ssp585", m)
  }));
  const span = d3.extent(allModels.flatMap(s => s.values), d => d.y);

  lineChart("#chart-models", 320, allModels.filter(s => state.models.has(s.name)),
    { yLabel: `${state.city}, SSP5-8.5, by model`, yDomain: span });

  legend("#legend-models", allModels.map(s => ({
    name: s.name, color: s.color, on: state.models.has(s.name)
  })), name => {
    if (state.models.has(name)) {
      if (state.models.size === 1) return;
      state.models.delete(name);
    } else {
      state.models.add(name);
    }
    draw();
  });
}

Promise.all([
  d3.csv("data/city_temps.csv", d3.autoType),
  d3.json("data/world_countries.json")
]).then(([rows, world]) => {
  prepare(rows, world);

  const pick = d3.select("#twin-pick");
  pick.selectAll("option")
    .data(D.cities.map(c => c.city).sort(d3.ascending))
    .join("option").attr("value", d => d).text(d => d);
  pick.property("value", state.city);
  pick.on("change", e => { state.city = e.target.value; draw(); });

  const slider = document.getElementById("year");
  const out = document.getElementById("year-out");
  slider.oninput = e => { state.year = +e.target.value; out.textContent = state.year; mapChart(); };
  document.querySelectorAll("input[name=scen]").forEach(r => {
    r.onchange = e => { state.scenario = e.target.value; mapChart(); };
  });

  draw();

  let t;
  const redraw = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  addEventListener("resize", redraw);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
});
