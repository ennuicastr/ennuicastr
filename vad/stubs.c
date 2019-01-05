#include <stdlib.h>

void rtc_FatalMessage(const char *file, int line, const char *msg) {
    (void) file;
    (void) line;
    (void) msg;
    exit(1);
}
