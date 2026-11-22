/* XiaoNiuBaWang standalone libretro frontend. SPDX-License-Identifier: GPL-2.0-or-later */
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <emscripten/emscripten.h>
#include "libretro.h"

#define API EMSCRIPTEN_KEEPALIVE
#define MAX_WIDTH 1024
#define MAX_HEIGHT 512
#define MAX_AUDIO_FRAMES 8192
#define DEVICE_GAMEPAD RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_JOYPAD, 1)
#define DEVICE_FAMILY RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_KEYBOARD, 4)
#define DEVICE_SUBOR RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_KEYBOARD, 5)

static uint8_t pixels[MAX_WIDTH * MAX_HEIGHT * 4];
static int16_t pcm[MAX_AUDIO_FRAMES * 2];
static uint8_t keys[RETROK_LAST];
static uint16_t buttons[4];
static unsigned width, height, audio_frames, pixel_format;
static unsigned frame_number, keyboard_device, extra_players;
static unsigned keyboard_polls;
static int initialized, loaded;
static uint8_t *rom_data;
static struct retro_game_info_ext game_info_ext;
static struct retro_system_av_info av;
static const struct retro_core_option_v2_definition *options;
static const struct retro_core_option_definition *options_v1;
static char error_text[512];

static void core_log(enum retro_log_level level, const char *fmt, ...) {
   va_list args;
   if (level < RETRO_LOG_WARN) return;
   va_start(args, fmt);
   vsnprintf(error_text, sizeof(error_text), fmt, args);
   va_end(args);
}

static bool environment(unsigned command, void *data) {
   unsigned i;
   switch (command) {
      case RETRO_ENVIRONMENT_GET_GAME_INFO_EXT:
         if (!rom_data) return false;
         *(const struct retro_game_info_ext **)data = &game_info_ext;
         return true;
      case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
         ((struct retro_log_callback *)data)->log = core_log;
         return true;
      case RETRO_ENVIRONMENT_GET_CAN_DUPE:
         *(bool *)data = true;
         return true;
      case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
         if (*(unsigned *)data > RETRO_PIXEL_FORMAT_RGB565) return false;
         pixel_format = *(unsigned *)data;
         return true;
      case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
         *(unsigned *)data = 2;
         return true;
      case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
         options = ((struct retro_core_options_v2 *)data)->definitions;
         return true;
      case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
         options = ((struct retro_core_options_v2_intl *)data)->us->definitions;
         return true;
      case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
         options_v1 = (const struct retro_core_option_definition *)data;
         return true;
      case RETRO_ENVIRONMENT_GET_VARIABLE: {
         struct retro_variable *variable = (struct retro_variable *)data;
         variable->value = NULL;
         if (options) {
            for (i = 0; options[i].key; ++i) {
               if (!strcmp(variable->key, options[i].key)) {
                  variable->value = options[i].default_value ? options[i].default_value : options[i].values[0].value;
                  return variable->value != NULL;
               }
            }
         }
         if (options_v1) {
            for (i = 0; options_v1[i].key; ++i) {
               if (!strcmp(variable->key, options_v1[i].key)) {
                  variable->value = options_v1[i].default_value ? options_v1[i].default_value : options_v1[i].values[0].value;
                  return variable->value != NULL;
               }
            }
         }
         return false;
      }
      case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
         *(bool *)data = false;
         return true;
      case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY:
         *(const char **)data = "/";
         return true;
      case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
         return true;
      case RETRO_ENVIRONMENT_GET_INPUT_MAX_USERS:
         *(unsigned *)data = 4;
         return true;
      case RETRO_ENVIRONMENT_GET_LANGUAGE:
         *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
         return true;
      case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE:
         *(int *)data = 3;
         return true;
      case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
         av = *(struct retro_system_av_info *)data;
         return true;
      case RETRO_ENVIRONMENT_SET_GEOMETRY:
         av.geometry = *(struct retro_game_geometry *)data;
         return true;
      case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
      case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
      case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:
      case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
      case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
      case RETRO_ENVIRONMENT_SET_CONTENT_INFO_OVERRIDE:
      case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
      case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK:
         return true;
      default:
         return false;
   }
}

static void video(const void *data, unsigned w, unsigned h, size_t pitch) {
   unsigned x, y;
   if (!data || data == RETRO_HW_FRAME_BUFFER_VALID || w > MAX_WIDTH || h > MAX_HEIGHT) return;
   for (y = 0; y < h; ++y) {
      const uint8_t *row = (const uint8_t *)data + y * pitch;
      uint8_t *out = pixels + y * w * 4;
      for (x = 0; x < w; ++x) {
         unsigned r, g, b;
         if (pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
            uint32_t v;
            memcpy(&v, row + x * 4, sizeof(v));
            r = (v >> 16) & 255; g = (v >> 8) & 255; b = v & 255;
         } else {
            uint16_t v;
            memcpy(&v, row + x * 2, sizeof(v));
            if (pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
               r = (v >> 11) & 31; g = (v >> 5) & 63; b = v & 31;
               g = (g << 2) | (g >> 4);
            } else {
               r = (v >> 10) & 31; g = (v >> 5) & 31; b = v & 31;
               g = (g << 3) | (g >> 2);
            }
            r = (r << 3) | (r >> 2); b = (b << 3) | (b >> 2);
         }
         out[x * 4] = (uint8_t)r;
         out[x * 4 + 1] = (uint8_t)g;
         out[x * 4 + 2] = (uint8_t)b;
         out[x * 4 + 3] = 255;
      }
   }
   width = w; height = h;
}

static size_t audio_batch(const int16_t *data, size_t frames) {
   size_t available = MAX_AUDIO_FRAMES - audio_frames;
   size_t count = frames < available ? frames : available;
   memcpy(pcm + audio_frames * 2, data, count * 2 * sizeof(int16_t));
   audio_frames += (unsigned)count;
   return frames;
}

static void audio_sample(int16_t left, int16_t right) {
   int16_t pair[2];
   pair[0] = left; pair[1] = right;
   audio_batch(pair, 1);
}

static void poll(void) {}
static int16_t input(unsigned port, unsigned device, unsigned index, unsigned id) {
   (void)index;
   if (device == RETRO_DEVICE_KEYBOARD) {
      ++keyboard_polls;
      return id < RETROK_LAST ? keys[id] : 0;
   }
   if ((device & RETRO_DEVICE_MASK) == RETRO_DEVICE_JOYPAD && port < 4) {
      if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)buttons[port];
      return id < 16 ? (buttons[port] >> id) & 1 : 0;
   }
   return 0;
}

API void xn_release_all(void) {
   memset(keys, 0, sizeof(keys));
   memset(buttons, 0, sizeof(buttons));
}

API int xn_init(void) {
   if (initialized) return 1;
   retro_set_environment(environment);
   retro_set_video_refresh(video);
   retro_set_audio_sample(audio_sample);
   retro_set_audio_sample_batch(audio_batch);
   retro_set_input_poll(poll);
   retro_set_input_state(input);
   retro_init();
   initialized = 1;
   return 1;
}

API void xn_unload(void) {
   if (loaded) retro_unload_game();
   loaded = 0;
   free(rom_data); rom_data = NULL;
   width = height = audio_frames = frame_number = keyboard_polls = extra_players = 0;
   xn_release_all();
}

API int xn_load(const uint8_t *bytes, unsigned size) {
   struct retro_game_info info;
   unsigned i;
   xn_unload();
   error_text[0] = 0;
   if (!initialized || !bytes || size < 16 || size > 64 * 1024 * 1024) return 0;
   rom_data = (uint8_t *)malloc(size);
   if (!rom_data) return 0;
   memcpy(rom_data, bytes, size);
   memset(&info, 0, sizeof(info));
   info.path = "/content.nes";
   info.data = rom_data;
   info.size = size;
   memset(&game_info_ext, 0, sizeof(game_info_ext));
   game_info_ext.full_path = info.path;
   game_info_ext.dir = "/";
   game_info_ext.name = "content";
   game_info_ext.ext = "nes";
   game_info_ext.data = rom_data;
   game_info_ext.size = size;
   game_info_ext.persistent_data = true;
   pixel_format = RETRO_PIXEL_FORMAT_0RGB1555;
   loaded = retro_load_game(&info);
   if (!loaded) { free(rom_data); rom_data = NULL; return 0; }
   retro_get_system_av_info(&av);
   for (i = 0; i < 4; ++i)
      retro_set_controller_port_device(i, i < 2 ? DEVICE_GAMEPAD : RETRO_DEVICE_NONE);
   retro_set_controller_port_device(4, keyboard_device);
   return 1;
}

API int xn_run(void) {
   if (!loaded) return 0;
   audio_frames = 0;
   keyboard_polls = 0;
   retro_run();
   ++frame_number;
   return 1;
}
API void xn_reset(void) { if (loaded) { xn_release_all(); retro_reset(); } }
API void xn_set_key(unsigned key, int down) { if (key < RETROK_LAST) keys[key] = down != 0; }
API void xn_set_button(unsigned player, unsigned button, int down) {
   if (player >= 4 || button >= 16) return;
   if (loaded && player >= 2 && !(extra_players & (1U << player))) {
      retro_set_controller_port_device(player, DEVICE_GAMEPAD);
      extra_players |= 1U << player;
   }
   if (down) buttons[player] |= (uint16_t)(1U << button);
   else buttons[player] &= (uint16_t)~(1U << button);
}
API int xn_set_keyboard(unsigned device) {
   if (device != RETRO_DEVICE_NONE && device != DEVICE_FAMILY && device != DEVICE_SUBOR) return 0;
   keyboard_device = device;
   xn_release_all();
   if (loaded) retro_set_controller_port_device(4, device);
   return 1;
}
API unsigned xn_keyboard_device(void) { return keyboard_device; }
API unsigned xn_keyboard_polls(void) { return keyboard_polls; }
API unsigned xn_frame_number(void) { return frame_number; }
API unsigned xn_width(void) { return width; }
API unsigned xn_height(void) { return height; }
API unsigned xn_pixels(void) { return (unsigned)(uintptr_t)pixels; }
API unsigned xn_audio(void) { return (unsigned)(uintptr_t)pcm; }
API unsigned xn_audio_frames(void) { return audio_frames; }
API double xn_fps(void) { return av.timing.fps; }
API double xn_sample_rate(void) { return av.timing.sample_rate; }
API unsigned xn_state_size(void) { return loaded ? (unsigned)retro_serialize_size() : 0; }
API int xn_state_save(void *data, unsigned size) { return loaded && data && retro_serialize(data, size); }
API int xn_state_load(const void *data, unsigned size) {
   int ok = loaded && data && size && retro_unserialize(data, size);
   if (ok) xn_release_all();
   return ok;
}
API unsigned xn_memory_data(unsigned type) { return loaded ? (unsigned)(uintptr_t)retro_get_memory_data(type) : 0; }
API unsigned xn_memory_size(unsigned type) { return loaded ? (unsigned)retro_get_memory_size(type) : 0; }
API const char *xn_error(void) { return error_text; }
API const char *xn_version(void) { return "FCEUmm 77468e568d9fe9c48d684ca911f1a3fe7259fdf7 + XiaoNiuBaWang keyboard bridge 1"; }
API void xn_destroy(void) { xn_unload(); if (initialized) retro_deinit(); initialized = 0; }
