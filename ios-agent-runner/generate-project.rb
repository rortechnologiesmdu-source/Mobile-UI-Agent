#!/usr/bin/env ruby
# Generates AgentRunner.xcodeproj:
#   AgentRunnerHost     – the MobileUse Agent app (task screen) on the simulator
#   AgentRunnerUITests  – the iOS runner that drives other apps via XCUIAutomation
#   Shared/             – wire types used by both
# Uses the xcodeproj gem that ships with CocoaPods, so no extra tooling is needed.
#
#   ruby generate-project.rb
#
# Re-run after adding or removing Swift files (run-task.sh / serve.sh do it for you).
require 'xcodeproj'

ROOT = __dir__
PROJECT_PATH = File.join(ROOT, 'AgentRunner.xcodeproj')
DEPLOYMENT_TARGET = '17.0'

project = Xcodeproj::Project.new(PROJECT_PATH)

# One group per folder; every .swift file in it is compiled into each given target.
def add_sources(project, dir, targets)
  group = project.main_group.find_subpath(dir, true)
  group.set_source_tree('<group>')
  group.set_path(dir)
  files = Dir.glob(File.join(ROOT, dir, '*.swift')).sort.map do |path|
    group.new_reference(File.basename(path))
  end
  targets.each { |target| target.add_file_references(files) }
end

host = project.new_target(:application, 'AgentRunnerHost', :ios, DEPLOYMENT_TARGET)
tests = project.new_target(:ui_test_bundle, 'AgentRunnerUITests', :ios, DEPLOYMENT_TARGET)

add_sources(project, 'AgentRunnerHost', [host])
add_sources(project, 'AgentRunnerUITests', [tests])
add_sources(project, 'Shared', [host, tests])

host.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.mobileuse.agentrunner.host',
    'PRODUCT_NAME' => 'AgentRunnerHost',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    # Merged into the generated Info.plist: allows HTTP to the local backend.
    'INFOPLIST_FILE' => 'AgentRunnerHost/Info.plist',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName' => 'MobileUse Agent',
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic',
  )
end

tests.add_dependency(host)
tests.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.mobileuse.agentrunner.uitests',
    'PRODUCT_NAME' => 'AgentRunnerUITests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'TEST_TARGET_NAME' => 'AgentRunnerHost',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic',
  )
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(host, tests)
scheme.save_as(PROJECT_PATH, 'AgentRunner', true)

puts "Generated #{PROJECT_PATH} (scheme: AgentRunner)"
