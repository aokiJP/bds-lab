// The kernel's uinput and input interface, as lab-pad needs it, without the C library's or the kernel's headers: the same
// on every 64-bit Linux the lab builds lab-pad for (x86_64, arm64: both use the generic ioctl numbers and layouts), so a
// cross build needs no sysroot. tests/app-offline.mjs checks every value here against <linux/uinput.h> on the machine.
#ifndef LAB_UINPUT_H
#define LAB_UINPUT_H

struct input_event { long sec, usec; unsigned short type, code; int value; };
struct input_absinfo { int value, minimum, maximum, fuzz, flat, resolution; };
struct input_id { unsigned short bustype, vendor, product, version; };
struct uinput_setup { struct input_id id; char name[80]; unsigned int ff_effects_max; };
struct uinput_abs_setup { unsigned short code; struct input_absinfo absinfo; };

// _IOC(dir, type, nr, size) = dir << 30 | size << 16 | type << 8 | nr   (dir: 0 none, 1 write)
#define LAB_IOC(dir, type, nr, size) ((unsigned long)(((dir) << 30) | ((size) << 16) | ((type) << 8) | (nr)))
#define UI_DEV_CREATE LAB_IOC(0, 'U', 1, 0)
#define UI_DEV_SETUP LAB_IOC(1, 'U', 3, sizeof(struct uinput_setup))
#define UI_ABS_SETUP LAB_IOC(1, 'U', 4, sizeof(struct uinput_abs_setup))
#define UI_SET_EVBIT LAB_IOC(1, 'U', 100, sizeof(int))
#define UI_SET_KEYBIT LAB_IOC(1, 'U', 101, sizeof(int))
#define UI_SET_ABSBIT LAB_IOC(1, 'U', 103, sizeof(int))

#define EV_SYN 0x00
#define EV_KEY 0x01
#define EV_ABS 0x03
#define SYN_REPORT 0
#define BTN_A 0x130
#define BTN_B 0x131
#define BTN_X 0x133
#define BTN_Y 0x134
#define BTN_TL 0x136
#define BTN_TR 0x137
#define BTN_SELECT 0x13a
#define BTN_START 0x13b
#define BTN_MODE 0x13c
#define BTN_THUMBL 0x13d
#define BTN_THUMBR 0x13e
#define ABS_X 0x00
#define ABS_Y 0x01
#define ABS_Z 0x02
#define ABS_RX 0x03
#define ABS_RY 0x04
#define ABS_RZ 0x05
#define ABS_HAT0X 0x10
#define ABS_HAT0Y 0x11
#define BUS_USB 0x03

#endif
