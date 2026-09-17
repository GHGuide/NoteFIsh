cmake_minimum_required(VERSION 3.20)
project(NoteFishVoice LANGUAGES CXX)

# NoteFIsh Voice: a virtual microphone (Core Audio Server Plug-in) that call apps
# select as their mic. The companion streams the Fish voice into it over UDP.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0")

include(FetchContent)
FetchContent_Declare(libASPL GIT_REPOSITORY https://github.com/gavv/libASPL.git GIT_TAG main)
FetchContent_MakeAvailable(libASPL)

add_library(NoteFishVoice MODULE src/Driver.cpp)
target_link_libraries(NoteFishVoice PRIVATE libASPL "-framework CoreFoundation" "-framework CoreAudio")
set_target_properties(NoteFishVoice PROPERTIES
  BUNDLE TRUE
  BUNDLE_EXTENSION "driver"
  OUTPUT_NAME "NoteFishVoice"
  MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
  MACOSX_BUNDLE_BUNDLE_NAME "NoteFishVoice"
  MACOSX_BUNDLE_GUI_IDENTIFIER "com.notefish.voice"
  MACOSX_BUNDLE_BUNDLE_VERSION "0.1.0"
  MACOSX_BUNDLE_SHORT_VERSION_STRING "0.1.0")
