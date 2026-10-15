#include <unity.h>

void setUp() {}
void tearDown() {}

static void test_toolchain_works() { TEST_ASSERT_EQUAL_INT(4, 2 + 2); }

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_toolchain_works);
    return UNITY_END();
}
