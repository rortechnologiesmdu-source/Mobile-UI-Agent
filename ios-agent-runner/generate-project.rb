#!/usr/bin/env ruby
# Generates AgentRunner.xcodeproj: a tiny host app plus the AgentRunnerUITests
# UI-test bundle that drives other apps via XCUIAutomation. Uses the xcodeproj gem
# that ships with CocoaPods, so no extra tooling is needed.
#
#   ruby generate-project.rb
#
# Re-run after adding or removing Swift files.
require 'xcodeproj'

ROOT = __dir__
PROJECT_PATH = File.join(ROOT, 'AgentRunner.xcodeproj')
DEPLOYMENT_TARGET = '17.0'

project = Xcodeproj::Project.new(PROJECT_PATH)

def add_sources(project, target, dir)
  group = project.main_group.find_subpath(dir, true)
  group.set_source_tree('<group>')
  group.set_path(dir)
  files = Dir.glob(File.join(ROOT, dir, '*.swift')).sort.map do |path|
    group.new_reference(File.basename(path))
  end
  target.add_file_references(files)
end

host = project.new_target(:application, 'AgentRunnerHost', :ios, DEPLOYMENT_TARGET)
add_sources(project, host, 'AgentRunnerHost')
host.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.mobileuse.agentrunner.host',
    'PRODUCT_NAME' => 'AgentRunnerHost',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName' => 'Agent Runner',
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic',
  )
end

tests = project.new_target(:ui_test_bundle, 'AgentRunnerUITests', :ios, DEPLOYMENT_TARGET)
add_sources(project, tests, 'AgentRunnerUITests')
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
