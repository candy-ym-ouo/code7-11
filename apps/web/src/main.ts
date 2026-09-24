import { createApp } from "vue";
import { createPinia } from "pinia";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

await useAuthStore(pinia).bootstrap();

app.use(router);
app.mount("#app");
