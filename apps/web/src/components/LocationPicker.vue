<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import maplibregl from "maplibre-gl";

const props = defineProps<{
  modelValue: [number, number];
  defaultCenter?: [number, number];
}>();

const emit = defineEmits<{ "update:modelValue": [value: [number, number]] }>();
const element = ref<HTMLDivElement | null>(null);
let map: maplibregl.Map | null = null;
let marker: maplibregl.Marker | null = null;
const tileUrl = import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const styleUrl = import.meta.env.VITE_MAP_STYLE_URL?.trim() || "";
const glyphsUrl = import.meta.env.VITE_MAP_GLYPHS_URL || "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

function placeMarker(point: [number, number]) {
  if (!map) return;
  marker?.remove();
  marker = new maplibregl.Marker({ color: "#0f766e", draggable: true })
    .setLngLat(point)
    .addTo(map);
  marker.on("dragend", () => {
    const value = marker?.getLngLat();
    if (value) emit("update:modelValue", [value.lng, value.lat]);
  });
}

onMounted(async () => {
  await nextTick();
  if (!element.value) return;
  const center = props.defaultCenter ?? props.modelValue;
  map = new maplibregl.Map({
    container: element.value,
    center,
    zoom: 14,
    style: styleUrl || {
      version: 8,
      glyphs: glyphsUrl,
      sources: { osm: { type: "raster", tiles: [tileUrl], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    }
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.getCanvas().style.cursor = "crosshair";
  placeMarker(props.modelValue);
  map.on("click", (event) => {
    const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
    emit("update:modelValue", point);
    placeMarker(point);
  });
});

watch(() => props.modelValue, (value) => {
  map?.easeTo({ center: value, duration: 250 });
  placeMarker(value);
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="element" class="picker-map" aria-label="在地图上选择位置"></div>
</template>
