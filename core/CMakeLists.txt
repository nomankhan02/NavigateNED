cmake_minimum_required(VERSION 3.15)
project(navcore LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
)

if(EMSCRIPTEN)
    add_executable(navcore src/api.cpp)
    set_target_properties(navcore PROPERTIES
        OUTPUT_NAME "navcore"
        SUFFIX ".js"
    )
    target_link_options(navcore PRIVATE
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sSINGLE_FILE=1"
        "-sEXPORTED_FUNCTIONS=['_call','_malloc','_free']"
        "-sEXPORTED_RUNTIME_METHODS=['cwrap','stringToUTF8','UTF8ToString']"
        "-sALLOW_MEMORY_GROWTH=1"
    )
else()
    # Native test runner executable
    enable_testing()
    add_executable(core_tests
        tests/test_main.cpp
        src/api.cpp
    )
    add_test(NAME core_tests COMMAND core_tests)
endif()

